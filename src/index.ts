import * as path from "path";
import * as vscode from "vscode";

const recentEvents: {
	deleted?: vscode.Uri;
	created?: vscode.Uri;
	timer?: NodeJS.Timeout;
} = {};

export function activate(context: vscode.ExtensionContext) {
	const watcher = vscode.workspace.createFileSystemWatcher("**/*");

	watcher.onDidDelete((uri) => {
		recentEvents.deleted = uri;
		tryHandleMove();
	});

	watcher.onDidCreate((uri) => {
		recentEvents.created = uri;
		tryHandleMove();
	});

	context.subscriptions.push(watcher);
	vscode.window.showInformationMessage("C++ Include Updater activated.");
}

function tryHandleMove() {
	if (recentEvents.deleted && recentEvents.created) {
		const oldUri = recentEvents.deleted;
		const newUri = recentEvents.created;

		clearTimeout(recentEvents.timer);

		recentEvents.timer = setTimeout(async () => {
			try {
				const stat = await vscode.workspace.fs.stat(newUri);
				if (stat.type === vscode.FileType.Directory) {
					await handleFolderMoveOrRename(oldUri, newUri);
				} else {
					await handleFileMoveOrRename(oldUri, newUri, [[oldUri, newUri]]);
				}
			} catch (err) {
				console.error("Move handler error:", err);
			} finally {
				recentEvents.deleted = undefined;
				recentEvents.created = undefined;
			}
		}, 200);
	}
}

async function handleFolderMoveOrRename(
	oldFolder: vscode.Uri,
	newFolder: vscode.Uri
) {
	const newUris = await vscode.workspace.findFiles(
		new vscode.RelativePattern(newFolder, "**/*.{c,cpp,h,hpp}")
	);

	const oldUris = newUris.map((fileUri) => {
		const relPath = path
			.relative(newFolder.fsPath, fileUri.fsPath)
			.replace(/\\/g, "/");
		return vscode.Uri.joinPath(oldFolder, relPath);
	});

	const oldUriTonewUriMap: [vscode.Uri, vscode.Uri][] = [];
	for (let i = 0; i < oldUris.length; i++) {
		oldUriTonewUriMap[i] = [oldUris[i], newUris[i]];
	}

	await Promise.all(
		oldUriTonewUriMap.map((el) =>
			handleFileMoveOrRename(el[0], el[1], oldUriTonewUriMap)
		)
	);
}

async function handleFileMoveOrRename(
	oldUri: vscode.Uri,
	newUri: vscode.Uri,
	oldUriTonewUriMap: [vscode.Uri, vscode.Uri][]
) {
	const files = await vscode.workspace.findFiles(`**/*.{c,cpp,h,hpp}`);

	// const basename = path.basename(oldUri.fsPath);
	// const candidates: vscode.Uri[] = [];
	// for (const file of files) {
	// 	if (file.fsPath === newUri.fsPath) continue;

	// 	const content = await vscode.workspace.fs.readFile(file);
	// 	if (content.toString().includes(basename)) candidates.push(file);
	// }

	// console.log("test candidates: ", candidates);

	await Promise.all(
		files.map((file) =>
			updateIncludesInFile(file, oldUri, newUri, oldUriTonewUriMap)
		)
	);
}

async function updateIncludesInFile(
	file: vscode.Uri,
	oldUri: vscode.Uri,
	newUri: vscode.Uri,
	oldUriTonewUriMap: [vscode.Uri, vscode.Uri][]
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

		const alsoMovingFileIdx = oldUriTonewUriMap
			.map((el) => el[0].fsPath)
			.findIndex((el) => el === fileIncAbs);

		if (alsoMovingFileIdx !== -1) {
			// console.log(
			// 	"test alsoMovingFile: ",
			// 	oldUriTonewUriMap[alsoMovingFileIdx][1].fsPath
			// );

			fileIncAbs = oldUriTonewUriMap[alsoMovingFileIdx][1].fsPath;
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

	await Promise.all([
		vscode.workspace.fs.writeFile(file, Buffer.from(newText, "utf8")),
	]);

	// console.log(`Updated includes in ${path.basename(file.fsPath)}`);
}

export function deactivate() {}
