import * as path from 'path';
import * as vscode from 'vscode';

let lastCreated: vscode.Uri | null = null;

export function activate(context: vscode.ExtensionContext) {
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

async function handleFileRename(oldUri: vscode.Uri, newUri: vscode.Uri) {
    const files = await vscode.workspace.findFiles('**/*.{c,cpp,h,hpp}');

   for (const file of files) {
        const document = await vscode.workspace.openTextDocument(file);
        const text = document.getText();
        const lines = text.split(/\r?\n/);

        let changed = false;
        let newLines: string[] = [];

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
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(text.length)
            );
            edit.replace(file, fullRange, newText);
            await vscode.workspace.applyEdit(edit);
            await document.save();
            vscode.window.showInformationMessage(`Updated includes in ${path.basename(file.fsPath)}`);
        }
    }
}

export function deactivate() {}