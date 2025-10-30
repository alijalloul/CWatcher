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
let lastCreated = null;
function activate(context) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{h,hpp,c,cpp}');
    watcher.onDidCreate((uri) => {
        lastCreated = uri;
        setTimeout(() => { lastCreated = null; }, 2000); // forget after 2s
    });
    watcher.onDidDelete(async (uri) => {
        if (lastCreated) {
            await handleFileRename(uri, lastCreated);
            lastCreated = null;
        }
    });
    context.subscriptions.push(watcher);
    vscode.window.showInformationMessage('C++ Include Updater activated.');
}
async function handleFileRename(oldUri, newUri) {
    const files = await vscode.workspace.findFiles('**/*.{c,cpp,h,hpp}');
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
                const absIncludePath = path.resolve(path.dirname(file.fsPath), includePath);
                if (path.normalize(absIncludePath) === path.normalize(oldUri.fsPath)) {
                    const newRel = path.relative(path.dirname(file.fsPath), newUri.fsPath).replace(/\\/g, '/');
                    const updated = `#include "${newRel}"`;
                    newLines.push(updated);
                    changed = true;
                    continue;
                }
            }
            newLines.push(line);
        }
        if (changed) {
            const newText = newLines.join('\n');
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
