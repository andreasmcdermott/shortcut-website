import React, {PropsWithChildren} from 'react';
import * as Ink from 'ink';
import * as Ui from '@inkjs/ui';
import {ShortcutClient} from '@shortcut/client';
import fs from 'node:fs';
import path from 'node:path';
import {marked} from 'marked';
import crypto from 'node:crypto';

type Site = {
	apiKey: string;
	name: string;
	slug: string;
	objectiveId: number;
};

type SiteContext = Site & {
	images: {url: string; filename: string; promise: Promise<void>}[];
};

const AppStateContext = React.createContext<{
	current: string | null;
	sites: Site[];
	addSite: (s: Site) => void;
}>({
	current: null,
	sites: [],
	addSite: () => {},
});

const useAppState = () => {
	const state = React.useContext(AppStateContext);
	if (!state) throw new Error('useAppState must be used within an AppProvider');
	return state;
};

const AppStateProvider = ({
	current = null,
	children,
}: PropsWithChildren<{current: string | null | undefined}>) => {
	const [sites, setSites] = React.useState<Site[]>(() => {
		try {
			return JSON.parse(fs.readFileSync('./sites.json', 'utf8'));
		} catch (err) {
			return [];
		}
	});

	React.useEffect(() => {
		fs.writeFileSync('./sites.json', JSON.stringify(sites));
	}, [sites]);

	return (
		<AppStateContext.Provider
			value={{
				current,
				sites,
				addSite: React.useCallback(
					site => setSites(prev => [...prev, site]),
					[],
				),
			}}
		>
			{children}
		</AppStateContext.Provider>
	);
};

const CreateSite = () => {
	const {addSite} = useAppState();
	const [isFetching, setIsFetching] = React.useState(false);
	const [isCreating, setIsCreating] = React.useState(false);
	const clientRef = React.useRef<ShortcutClient>();
	const [newSite, updateSite] = React.useState<{
		objectiveId: number;
		name: string;
		workspaceName: string;
		apiKey: string;
		err: any | null;
	}>({
		objectiveId: -1,
		name: '',
		workspaceName: '',
		apiKey: '',
		err: null,
	});

	if (isFetching) return <Ui.Spinner label="Fetching workspace..." />;
	if (isCreating)
		return (
			<Ink.Box flexDirection="column">
				<Ink.Text>
					Great! We will now create some data in your workspace that is specific
					to the your website.
				</Ink.Text>
				<Ui.Spinner label="This should only take a few seconds..." />
			</Ink.Box>
		);

	if (!newSite.apiKey) {
		return (
			<Ink.Box flexDirection="column">
				{newSite.err && (
					<Ui.StatusMessage variant="error">
						That was not a valid API key. Please try again.
					</Ui.StatusMessage>
				)}
				<Ink.Box flexDirection="row" gap={1}>
					<Ink.Text>Enter your API key:</Ink.Text>
					<Ui.TextInput
						defaultValue=""
						onSubmit={async apiKey => {
							if (apiKey) {
								setIsFetching(true);

								try {
									clientRef.current = new ShortcutClient(apiKey);
									const member =
										await clientRef.current!.getCurrentMemberInfo();
									updateSite(prev => ({
										...prev,
										apiKey,
										workspaceName: member.data.workspace2.url_slug,
										err: '',
									}));
								} catch (err) {
									updateSite(prev => ({...prev, err}));
								} finally {
									setIsFetching(false);
								}
							}
						}}
					/>
				</Ink.Box>
			</Ink.Box>
		);
	}

	if (!newSite.name) {
		return (
			<Ink.Box flexDirection="row" gap={1}>
				<Ink.Text>Enter a name for your site:</Ink.Text>
				<Ui.TextInput
					defaultValue={newSite.workspaceName}
					onSubmit={async name => {
						if (name) {
							updateSite(prev => ({...prev, name, err: ''}));
							try {
								if (!clientRef.current) {
									clientRef.current = new ShortcutClient(newSite.apiKey);
								}

								setIsCreating(true);
								const milestone = await clientRef.current!.createMilestone({
									name: `Website: ${name}`,
									description:
										'Each Epic in this Objective will be a separate page.',
								});
								updateSite(prev => ({
									...prev,
									objectiveId: milestone.data.id,
									err: '',
								}));
								addSite({
									slug: newSite.workspaceName,
									objectiveId: milestone.data.id,
									name,
									apiKey: newSite.apiKey,
								});
							} catch (err) {
								updateSite(prev => ({...prev, err}));
							} finally {
								setIsCreating(false);
							}
						}
					}}
				/>
			</Ink.Box>
		);
	}

	return (
		<Ink.Box flexDirection="column">
			<Ink.Text>🎉 All done!</Ink.Text>
		</Ink.Box>
	);
};

const downloadImage = (site: SiteContext, url: string) => {
	const filename = `${crypto.randomBytes(16).toString('hex')}${
		path.parse(url).ext
	}`;

	if (!fs.existsSync(path.resolve(`./sites/${site.name}/imgs/`)))
		fs.mkdirSync(path.resolve(`./sites/${site.name}/imgs/`));

	async function downloadImg() {
		try {
			const res = await fetch(`${url}?token=${site.apiKey}`);
			if (!res.ok) throw new Error();
			const buffer = await res.arrayBuffer();
			fs.writeFileSync(
				path.resolve(`./sites/${site.name}/imgs/${filename}`),
				Buffer.from(buffer),
			);
		} catch {}
	}

	const image = {url, filename, promise: downloadImg()};

	site.images.push(image);

	return filename;
};

const parseDescription = (site: SiteContext, description: string) => {
	description = description.replace(
		/!\[(.*)\]\((.+)\)/gm,
		(match, alt, src) => {
			if (src.startsWith('https://media.app.shortcut.com/')) {
				const filename = downloadImage(site, src);
				return `![${alt}](/imgs/${filename})`;
			}

			return match;
		},
	);

	return marked.parse(description);
};

const getStyles = () => `<style>
	html {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
		font-size: 16px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
	}

	body {
		margin: 0;
		padding: 0;
	}

	header {
		background-color: #f5f5f5;
		padding: 1rem;
	}

	main {
		padding: 1rem;
	}

	header nav {
		display: flex;
		flex-direction: row;
		gap: 1rem;
	}

	main nav {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	main nav a::before {
		content: '✎ ';
	}

	table {
		border: 1px solid #ccc;
		border-collapse: collapse;
		width: 100%;
	}

	tbody tr:nth-child(odd) {
		background-color: #f2f2f2;
	}

	td, th {
		border: 1px solid #ccc;
		padding: 0.5rem;
		text-align: left;
	}

	a {
		text-decoration: none;
		color: inherit;
	}

	a:hover {
		text-decoration: underline;
	}

	img {
		max-width: 100%;
	}

	h1, h2 {
		margin: 0;
	}

</style>`;

async function generateSite(site: SiteContext) {
	const client = new ShortcutClient(site.apiKey);
	const {data: milestone} = await client.getMilestone(site.objectiveId);
	const {data: epics} = await client.listMilestoneEpics(site.objectiveId);

	if (!fs.existsSync(path.resolve('./sites')))
		fs.mkdirSync(path.resolve('./sites'));
	if (fs.existsSync(path.resolve(`./sites/${site.name}`)))
		fs.rmSync(path.resolve(`./sites/${site.name}`), {recursive: true});

	fs.mkdirSync(path.resolve(`./sites/${site.name}`));

	fs.writeFileSync(
		path.resolve(`./sites/${site.name}/index.html`),
		`<!doctype html>
<html>
	<head>
		<title>${milestone.name} | Home</title>
		${getStyles()}
	</head>
	<body>
	<header>
		<nav>
			<a href="/">Home</a>
			${epics.map(epic => `<a href="/${epic.id}">${epic.name}</a>`).join('')}
		</nav>
		</header>
<main>
		<h1>${milestone.name}</h1>
		<p>${milestone.description}</p>
		</main>
	</body>
</html>`,
		'utf-8',
	);

	epics.forEach(async epic => {
		const {data: fullEpic} = await client.getEpic(epic.id);

		const {data: stories} = await client.listEpicStories(epic.id, {
			includes_description: true,
		});

		fs.mkdirSync(path.resolve(`./sites/${site.name}/${epic.id}`));
		fs.writeFileSync(
			path.resolve(`./sites/${site.name}/${epic.id}/index.html`),
			`<!doctype html>
	<html>
		<head>
			<title>${site.name} | ${epic.name}</title>
			${getStyles()}
		</head>
		<body>
		<header>
			<nav>
				<a href="/">Home</a>
				${epics.map(epic => `<a href="/${epic.id}">${epic.name}</a>`).join('')}
			</nav>
			</header>
			<main>
			<h2>${epic.name}</h2>
			${parseDescription(site, fullEpic.description)}
			${stories.length ? '<nav>' : ''}
			${stories
				.map(story => `<a href="/${epic.id}/${story.id}">${story.name}</a>`)
				.join('')}
			${stories.length ? '</nav>' : ''}
			<small>Last updated: ${epic.updated_at || epic.created_at}</small>
			</main>
		</body>
	</html>`,
			'utf-8',
		);

		stories.forEach(story => {
			fs.mkdirSync(path.resolve(`./sites/${site.name}/${epic.id}/${story.id}`));
			fs.writeFileSync(
				path.resolve(`./sites/${site.name}/${epic.id}/${story.id}/index.html`),
				`<!doctype html>
				<html>
					<head>
						<title>${site.name} | ${epic.name} | ${story.name}</title>
						${getStyles()}
					</head>
				<body>
				<header>
					<nav>
						<a href="/">Home</a>
						${epics.map(epic => `<a href="/${epic.id}">${epic.name}</a>`).join('')}
					</nav></header>
					<main>
					<a href="/${epic.id}">&larr; Back</a>
					<h2>${story.name}</h2>
					<small>${story.updated_at || story.created_at}</small>
					${parseDescription(site, story.description || '')}
					</main>
				</body>
			</html>`,
				'utf-8',
			);
		});
	});
}

const SitePicker = () => {
	const {sites} = useAppState();
	const {exit} = Ink.useApp();
	const [isGenerating, setIsGenerating] = React.useState(false);
	const [isDone, setIsDone] = React.useState(false);

	React.useEffect(() => {
		if (isDone) exit();
	}, [isDone, exit]);

	if (!sites.length) {
		return (
			<Ink.Box flexDirection="column" gap={1}>
				<Ui.StatusMessage variant="info">
					It seems like you don't have a site yet. Let's create one!
				</Ui.StatusMessage>
				<CreateSite />
			</Ink.Box>
		);
	}

	if (sites.length === 1) {
		return (
			<Ink.Box flexDirection="column">
				{isGenerating && <Ui.Spinner label="Generating your site..." />}
				{isDone ? (
					<Ui.StatusMessage variant="success">
						Your site is ready!
					</Ui.StatusMessage>
				) : (
					<Ink.Box flexDirection="row" gap={1}>
						<Ink.Text>Do you want to generate your site now?</Ink.Text>
						<Ui.ConfirmInput
							onConfirm={async () => {
								setIsGenerating(true);
								try {
									const context = {...sites[0], images: []} as SiteContext;
									await generateSite(context);
									Promise.all(context.images.map(i => i.promise)).then(() => {
										setIsDone(true);
										context.images = [];
									});
								} catch {
									setIsGenerating(false);
								}
							}}
							onCancel={() => exit()}
						/>
					</Ink.Box>
				)}
			</Ink.Box>
		);
	}

	return <Ink.Text>You got sites!</Ink.Text>;
};

export default function App({name = null}: {name: string | null | undefined}) {
	return (
		<AppStateProvider current={name}>
			<SitePicker />
		</AppStateProvider>
	);
}
