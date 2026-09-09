import type { SceneDescription } from '@openchart/scene';
import { renderSceneToSvg } from './index.js';
import { embedSvgFonts } from './fonts.js';

// Literal URLs let Vite copy these shared font files into the offline app build.
const urls = [
  new URL('../../scene/fonts/IBMPlexSans-Regular.ttf', import.meta.url),
  new URL('../../scene/fonts/IBMPlexSans-Medium.ttf', import.meta.url),
  new URL('../../scene/fonts/IBMPlexSans-SemiBold.ttf', import.meta.url),
  new URL('../../scene/fonts/IBMPlexSans-Bold.ttf', import.meta.url),
  new URL('../../scene/fonts/IBMPlexSans-Italic.ttf', import.meta.url),
  new URL('../../scene/fonts/IBMPlexSans-BoldItalic.ttf', import.meta.url),
  new URL('../../scene/fonts/IBMPlexMono-Regular.ttf', import.meta.url),
];
let pending: Promise<readonly Uint8Array[]> | undefined;
let license: Promise<string> | undefined;

export function loadBrowserFonts(): Promise<readonly Uint8Array[]> {
  pending ??= Promise.all(urls.map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('The bundled diagram font could not be loaded');
    return new Uint8Array(await response.arrayBuffer());
  })).catch((error: unknown) => { pending = undefined; throw error; });
  return pending;
}

export async function renderPortableSvg(scene: SceneDescription): Promise<string> {
  const fonts = await loadBrowserFonts();
  license ??= fetch(new URL('../../scene/fonts/OFL.txt', import.meta.url)).then(async (response) => {
    if (!response.ok) throw new Error('The bundled font license could not be loaded');
    return response.text();
  }).catch((error: unknown) => { license = undefined; throw error; });
  return embedSvgFonts(renderSceneToSvg(scene), fonts.map((bytes) => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }), await license);
}
