"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const recentEvents = {};
function activate(context) {
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
                }
                else {
                    await handleFileMoveOrRename(oldUri, newUri, [[oldUri, newUri]]);
                }
            }
            catch (err) {
                console.error("Move handler error:", err);
            }
            finally {
                recentEvents.deleted = undefined;
                recentEvents.created = undefined;
            }
        }, 200);
    }
}
async function handleFolderMoveOrRename(oldFolder, newFolder) {
    const newUris = await vscode.workspace.findFiles(new vscode.RelativePattern(newFolder, "**/*.{c,cpp,h,hpp}"));
    const oldUris = newUris.map((fileUri) => {
        const relPath = path
            .relative(newFolder.fsPath, fileUri.fsPath)
            .replace(/\\/g, "/");
        return vscode.Uri.joinPath(oldFolder, relPath);
    });
    const oldUriTonewUriMap = [];
    for (let i = 0; i < oldUris.length; i++) {
        oldUriTonewUriMap[i] = [oldUris[i], newUris[i]];
    }
    await Promise.all(oldUriTonewUriMap.map((el) => handleFileMoveOrRename(el[0], el[1], oldUriTonewUriMap)));
}
async function handleFileMoveOrRename(oldUri, newUri, oldUriTonewUriMap) {
    const files = await vscode.workspace.findFiles(`**/*.{c,cpp,h,hpp}`);
    // const basename = path.basename(oldUri.fsPath);
    // const candidates: vscode.Uri[] = [];
    // for (const file of files) {
    // 	if (file.fsPath === newUri.fsPath) continue;
    // 	const content = await vscode.workspace.fs.readFile(file);
    // 	if (content.toString().includes(basename)) candidates.push(file);
    // }
    // console.log("test candidates: ", candidates);
    await Promise.all(files.map((file) => updateIncludesInFile(file, oldUri, newUri, oldUriTonewUriMap)));
}
async function updateIncludesInFile(file, oldUri, newUri, oldUriTonewUriMap) {
    const raw = await vscode.workspace.fs.readFile(file);
    const text = raw.toString();
    const lines = text.split(/\r?\n/);
    let changed = false;
    const newLines = lines.map((line) => {
        const match = line.match(/#include\s+"([^"]+)"/);
        if (!match)
            return line;
        const includePath = match[1];
        let fileIncAbs = "";
        if (newUri.fsPath === file.fsPath) {
            fileIncAbs = path.resolve(path.dirname(oldUri.fsPath), includePath);
        }
        else {
            let oldUriIncAbs = path.resolve(path.dirname(file.fsPath), includePath);
            if (oldUriIncAbs === oldUri.fsPath) {
                fileIncAbs = newUri.fsPath;
            }
            else {
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
        let newRel = "";
        if (newUri.fsPath === file.fsPath) {
            newRel = path
                .relative(path.dirname(newUri.fsPath), fileIncAbs)
                .replace(/\\/g, "/");
        }
        else {
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
    if (!changed)
        return;
    const newText = newLines.join("\n");
    const edit = new vscode.WorkspaceEdit();
    edit.replace(file, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0), newText);
    const doc = await vscode.workspace.openTextDocument(file.fsPath);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
    // console.log(`Updated includes in ${path.basename(file.fsPath)}`);
}
function deactivate() { }
