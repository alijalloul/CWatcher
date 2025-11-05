import * as path from "path";
import * as vscode from "vscode";

const recentEvents: {
	deleted: vscode.Uri[];
	created: vscode.Uri[];
	timer?: NodeJS.Timeout;
} = { deleted: [], created: [] };

export function activate(context: vscode.ExtensionContext) {
	const watcher = vscode.workspace.createFileSystemWatcher("**/*");

	watcher.onDidDelete((uri) => {
		recentEvents.deleted.push(uri);

		clearTimeout(recentEvents.timer);

		recentEvents.timer = setTimeout(async () => {
			await tryHandleMove();
		}, 200);
	});

	watcher.onDidCreate((uri) => {
		recentEvents.created.push(uri);
		clearTimeout(recentEvents.timer);

		recentEvents.timer = setTimeout(async () => {
			await tryHandleMove();
		}, 200);
	});

	context.subscriptions.push(watcher);
	vscode.window.showInformationMessage("C++ Include Updater activated.");
}

async function tryHandleMove() {
	const oldUriToNewUriMap: [vscode.Uri, vscode.Uri][] = (
		await Promise.all(
			recentEvents.deleted.map(async (del) => {
				const basenameMatchingCreated: vscode.Uri = recentEvents.created.find(
					(created) =>
						path.basename(created.fsPath) === path.basename(del.fsPath)
				)!;

				const oldFolder = del;
				const newFolder = basenameMatchingCreated;

				const stat = await vscode.workspace.fs.stat(newFolder);
				if (stat.type === vscode.FileType.Directory) {
					const newUris = await vscode.workspace.findFiles(
						new vscode.RelativePattern(newFolder, "**/*.{c,cpp,h,hpp}")
					);

					const oldUris = newUris.map((fileUri) => {
						const relPath = path
							.relative(newFolder.fsPath, fileUri.fsPath)
							.replace(/\\/g, "/");
						return vscode.Uri.joinPath(oldFolder, relPath);
					});

					const partialOldUriToNewUriMap: [vscode.Uri, vscode.Uri][] = [];
					for (let i = 0; i < oldUris.length; i++) {
						partialOldUriToNewUriMap[i] = [oldUris[i], newUris[i]];
					}

					return partialOldUriToNewUriMap;
				}

				return [];
			})
		)
	).flat();
	// console.log("test oldUriToNewUriMap: ", oldUriToNewUriMap);

	await Promise.all(
		recentEvents.deleted.map(async (del) => {
			const basenameMatchingCreated: vscode.Uri = recentEvents.created.find(
				(created) => path.basename(created.fsPath) === path.basename(del.fsPath)
			)!;

			const oldUri = del;
			const newUri = basenameMatchingCreated;

			// console.log("test oldUri: ", oldUri);
			// console.log("test newUri: ", newUri);

			try {
				const stat = await vscode.workspace.fs.stat(newUri);
				if (stat.type === vscode.FileType.Directory) {
					await handleFolderMoveOrRename(oldUriToNewUriMap);
				} else {
					await handleFileMoveOrRename(oldUri, newUri, [[oldUri, newUri]]);
				}
			} catch (err) {
				console.error("Move handler error:", err);
			}
		})
	);

	recentEvents.deleted = [];
	recentEvents.created = [];
}

async function handleFolderMoveOrRename(
	oldUriToNewUriMap: [vscode.Uri, vscode.Uri][]
) {
	// console.log("test oldFolder: ", oldFolder);

	await Promise.all(
		oldUriToNewUriMap.map((el) =>
			handleFileMoveOrRename(el[0], el[1], oldUriToNewUriMap)
		)
	);
}

async function handleFileMoveOrRename(
	oldUri: vscode.Uri,
	newUri: vscode.Uri,
	oldUriToNewUriMap: [vscode.Uri, vscode.Uri][]
) {
	const files = await vscode.workspace.findFiles(`**/*.{c,cpp,h,hpp}`);

	await Promise.all(
		files.map((file) =>
			updateIncludesInFile(file, oldUri, newUri, oldUriToNewUriMap)
		)
	);
}

async function updateIncludesInFile(
	file: vscode.Uri,
	oldUri: vscode.Uri,
	newUri: vscode.Uri,
	oldUriToNewUriMap: [vscode.Uri, vscode.Uri][]
) {
	const raw = await vscode.workspace.fs.readFile(file);
	const text = raw.toString();
	const lines = text.split(/\r?\n/);
	let changed = false;

	const newLines = lines.map((line) => {
		const match = line.match(/#include\s+"([^"]+)"/);
		if (!match) return line;

		const includePath = match[1];
		let fileIncAbs: string = "";
		if (newUri.fsPath === file.fsPath) {
			fileIncAbs = path.resolve(path.dirname(oldUri.fsPath), includePath);
		} else {
			let oldUriIncAbs = path.resolve(path.dirname(file.fsPath), includePath);
			if (oldUriIncAbs === oldUri.fsPath) {
				fileIncAbs = newUri.fsPath;
			} else {
				fileIncAbs = oldUriIncAbs;
			}
		}

		const alsoMovingFileIdx = oldUriToNewUriMap
			.map((el) => el[0].fsPath)
			.findIndex((el) => el === fileIncAbs);

		if (alsoMovingFileIdx !== -1) {
			fileIncAbs = oldUriToNewUriMap[alsoMovingFileIdx][1].fsPath;
		}

		let newRel: string = "";
		if (newUri.fsPath === file.fsPath) {
			newRel = path
				.relative(path.dirname(newUri.fsPath), fileIncAbs)
				.replace(/\\/g, "/");
		} else {
			newRel = path
				.relative(path.dirname(file.fsPath), fileIncAbs)
				.replace(/\\/g, "/");
		}

		// console.log("\n------------------------------------\n");
		// console.log("test file.fsPath: ", file.fsPath);
		// console.log("test oldUri.fsPath: ", oldUri.fsPath);
		// console.log("test newUri.fsPath: ", newUri.fsPath);
		// console.log("test includePath: ", includePath);

		// console.log("test fileIncAbs: ", fileIncAbs);
		// console.log("test newRel: ", newRel);
		// console.log("\n------------------------------------\n");

		if (includePath !== newRel) {
			changed = true;

			return `#include "${newRel}"`;
		}

		return line;
	});

	if (!changed) return;

	const newText = newLines.join("\n");

	const edit = new vscode.WorkspaceEdit();
	edit.replace(
		file,
		new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0),
		newText
	);

	const doc = await vscode.workspace.openTextDocument(file.fsPath);

	await vscode.workspace.applyEdit(edit);
	await doc.save();

	// console.log(`Updated includes in ${path.basename(file.fsPath)}`);
}

export function deactivate() {}
