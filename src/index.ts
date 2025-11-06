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
		}, 300);
	});

	watcher.onDidCreate((uri) => {
		recentEvents.created.push(uri);
		clearTimeout(recentEvents.timer);

		recentEvents.timer = setTimeout(async () => {
			await tryHandleMove();
		}, 300);
	});

	context.subscriptions.push(watcher);
	vscode.window.showInformationMessage("C++ Include Updater activated.");
}

async function tryHandleMove() {
	if (recentEvents.created.length === 0) {
		return;
	}
	if (recentEvents.created.length !== recentEvents.deleted.length) {
		return;
	}

	const allOldUriToNewUriMap: Record<string, [vscode.Uri, vscode.Uri][]> = {};

	await Promise.all(
		recentEvents.deleted.map(async (del) => {
			const basenameMatchingCreated: vscode.Uri = recentEvents.created.find(
				(created) => path.basename(created.fsPath) === path.basename(del.fsPath)
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

				const partialallOldUriToNewUriMap: [vscode.Uri, vscode.Uri][] = [];
				for (let i = 0; i < oldUris.length; i++) {
					partialallOldUriToNewUriMap[i] = [oldUris[i], newUris[i]];
				}

				allOldUriToNewUriMap[del.fsPath] = partialallOldUriToNewUriMap;
			}
		})
	);

	// console.log(
	// 	"test allOldUriToNewUriMap: ",
	// 	Object.values(allOldUriToNewUriMap).flat()
	// );

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
					await handleFolderMoveOrRename(
						allOldUriToNewUriMap[del.fsPath],
						Object.values(allOldUriToNewUriMap).flat()
					);
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
	oldUriToNewUriMap: [vscode.Uri, vscode.Uri][],
	allOldUriToNewUriMap: [vscode.Uri, vscode.Uri][]
) {
	// console.log("test oldFolder: ", oldFolder);

	await Promise.all(
		oldUriToNewUriMap.map((el) =>
			handleFileMoveOrRename(el[0], el[1], allOldUriToNewUriMap)
		)
	);
}

async function handleFileMoveOrRename(
	oldUri: vscode.Uri,
	newUri: vscode.Uri,
	allOldUriToNewUriMap: [vscode.Uri, vscode.Uri][]
) {
	const files = await vscode.workspace.findFiles(`**/*.{c,cpp,h,hpp}`);

	const candidates: vscode.Uri[] = files.filter((el) => {
		if (recentEvents.created.map((el2) => el2.fsPath).includes(el.fsPath)) {
			if (el.fsPath === newUri.fsPath) {
				return true;
			} else {
				return false;
			}
		}

		return true;
	});

	await Promise.all(
		candidates.map((file) =>
			updateIncludesInFile(file, oldUri, newUri, allOldUriToNewUriMap)
		)
	);
}

async function updateIncludesInFile(
	file: vscode.Uri,
	oldUri: vscode.Uri,
	newUri: vscode.Uri,
	allOldUriToNewUriMap: [vscode.Uri, vscode.Uri][]
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

		const alsoMovingFileIdx = allOldUriToNewUriMap
			.map((el) => el[0].fsPath)
			.findIndex((el) => el === fileIncAbs);

		if (alsoMovingFileIdx !== -1) {
			// console.log(
			// 	"test alsomoving: ",
			// 	allOldUriToNewUriMap[alsoMovingFileIdx][1].fsPath
			// );

			fileIncAbs = allOldUriToNewUriMap[alsoMovingFileIdx][1].fsPath;
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
