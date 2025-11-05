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
                    await handleFileMoveOrRename(oldUri, newUri);
                }
            }
            catch (err) {
                console.error("Move handler error:", err);
            }
            finally {
                recentEvents.deleted = undefined;
                recentEvents.created = undefined;
            }
        }, 100);
    }
}
async function handleFolderMoveOrRename(oldFolder, newFolder) {
    const newFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(newFolder, "**/*.{c,cpp,h,hpp}"));
    const oldFiles = newFiles.map((fileUri) => {
        const relPath = path
            .relative(newFolder.fsPath, fileUri.fsPath)
            .replace(/\\/g, "/");
        return vscode.Uri.joinPath(oldFolder, relPath);
    });
    for (let i = 0; i < oldFiles.length; i++) {
        await handleFileMoveOrRename(oldFiles[i], newFiles[i]);
    }
}
async function handleFileMoveOrRename(oldUri, newUri) {
    const files = await vscode.workspace.findFiles("**/*.{c,cpp,h,hpp}");
    for (const file of files) {
        const document = await vscode.workspace.openTextDocument(file);
        const text = document.getText();
        const lines = text.split(/\r?\n/);
        let changed = false;
        let newLines = [];
        for (const line of lines) {
            const match = line.match(/#include\s+"([^"]+)"/);
            if (match) {
                const includePath = match[1];
                let fileIncAbs = "";
                if (newUri.fsPath === file.fsPath) {
                    fileIncAbs = path.resolve(path.dirname(oldUri.fsPath), includePath);
                }
                else {
                    let oldFileIncAbs = path.resolve(path.dirname(file.fsPath), includePath);
                    if (oldFileIncAbs === oldUri.fsPath) {
                        fileIncAbs = newUri.fsPath;
                    }
                    else {
                        fileIncAbs = oldFileIncAbs;
                    }
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
                if (includePath !== newRel) {
                    const updated = `#include "${newRel}"`;
                    newLines.push(updated);
                    changed = true;
                    continue;
                }
            }
            newLines.push(line);
        }
        if (changed) {
            const newText = newLines.join("\n");
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
            edit.replace(file, fullRange, newText);
            await vscode.workspace.applyEdit(edit);
            await document.save();
            vscode.window.showInformationMessage(`Updated includes in ${path.basename(file.fsPath)}`);
        }
    }
}
function deactivate() { }
