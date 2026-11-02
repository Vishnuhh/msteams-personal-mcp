// QuickJS for code mode on Workers: the Wasm is bundled as a compiled module (wrangler's default rule for *.wasm),
// because Workers cannot fetch or read it at run time. Imported lazily, so plain Node never loads this file.
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import baseVariant from '@jitl/quickjs-ng-wasmfile-release-sync';
import wasmModule from '../../node_modules/@jitl/quickjs-ng-wasmfile-release-sync/dist/emscripten-module.wasm';

export const loadQuickJS = () => newQuickJSWASMModuleFromVariant(newVariant(baseVariant, { wasmModule }));
