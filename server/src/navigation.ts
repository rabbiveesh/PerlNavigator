import {
    DefinitionParams,
    Location,
    WorkspaceFolder
} from 'vscode-languageserver/node';
import {
    TextDocument
} from 'vscode-languageserver-textdocument';
import { PerlDocument, PerlElem, NavigatorSettings } from "./types";
import Uri from 'vscode-uri';
import { realpathSync, existsSync, realpath } from 'fs';
import { getIncPaths, async_execFile, getSymbol, lookupSymbol } from "./utils";
import { dirname, join } from 'path';



export function getDefinition(params: DefinitionParams, perlDoc: PerlDocument, txtDoc: TextDocument): Location[] | undefined {
    
    let position = params.position
    const symbol = getSymbol(position, txtDoc);

    if(!symbol) return;
    console.log("Looking for: " + symbol);

    const foundElems = lookupSymbol(perlDoc, symbol, position.line);

    if(foundElems.length == 0){
        console.log("Could not find word: " + symbol);
        return;
    }

    let locationsFound: Location[] = [];
    
    foundElems.forEach(elem => {
        const elemResolved: PerlElem | undefined = resolveElemForNav(perlDoc, elem, symbol);
        if(!elemResolved) return;

        // TODO: make this whole thing async
        if(!existsSync(elemResolved.file)) return; // Make sure the file exists and hasn't been deleted.
        let uri =  Uri.file(realpathSync(elemResolved.file)).toString(); // Resolve symlinks
        const newLoc: Location = {
            uri: uri,
            range: { 
                start: { line: elemResolved.line, character: 0 },
                end: { line: elemResolved.line, character: 500}
                }
        }
        locationsFound.push(newLoc);
    });    
    return locationsFound;
}


function resolveElemForNav (perlDoc: PerlDocument, elem: PerlElem, symbol: string): PerlElem | undefined {
    
    if(elem.file && !badFile(elem.file)){
        // Have file and is good.
        return elem;
    } else{
        // Try looking it up by package instead of file.
        // Happens with XS subs and Moo subs
        if(elem.package){
            const elemResolved = perlDoc.elems.get(elem.package);

            if(elemResolved?.length && elemResolved[0].file && !badFile(elem.file)){
                return elemResolved[0];
            }
        }

        // Finding the module with the stored mod didn't work. Let's try navigating to the package itself instead of Foo::Bar->method().
        // Many Moose methods end up here.
        // Not very helpful, since the user can simply click on the module manually if they want
        // const base_module = symbol.match(/^([\w:]+)->\w+$/);
        // if(base_module){
        //     const elemResolved = perlDoc.elems.get(base_module);
        //     if(elemResolved && elemResolved.file && !badFile(elem.file)){
        //         return elemResolved;
        //     }
        // }
    }
    return;
}


function badFile (file: string){
    return /(?:Sub[\\\/]Defer\.pm|Moo[\\\/]Object\.pm|Moose[\\\/]Object\.pm)$/.test(file);
}

export async function getAvailableMods(workspaceFolders: WorkspaceFolder[] | null, settings: NavigatorSettings): Promise<Map<string, string>> {
       
    let perlParams: string[] = [];
    perlParams = perlParams.concat(getIncPaths(workspaceFolders, settings));
    const modHunterPath = join(dirname(__dirname), 'src', 'perl', 'lib_bs22', 'ModHunter.pl');
    perlParams.push(modHunterPath);
    console.log("Starting to look for perl modules with " + perlParams.join(" "));

    const mods: Map<string, string> = new Map()

    let output: string;
    try {
        // This can be slow, especially if reading modules over a network or on windows. 
        const out = await async_execFile(settings.perlPath, perlParams, {timeout: 90000, maxBuffer: 3 * 1024 * 1024});
        output = out.stdout;
        console.log("Success running mod hunter");
    } catch(error: any) {
        console.log("ModHunter failed. You will lose autocomplete on importing modules. Not a huge deal");
        console.log(error);
        return mods;
    }

    output.split("\n").forEach(mod => {
        var items = mod.split('\t');

        if(items.length != 5 || items[1] != 'M' || !items[2] || !items[3]){
            return;
        }
        // Load file

        realpath(items[3], function(err, path) {
            if (err) {
                // Skip if error
            } else {
                if (!path) return; // Could file be empty, but no error?
                let uri =  Uri.file(path).toString(); // Resolve symlinks
                mods.set(items[2], uri);
            }
        });
    });
    return mods;
}
