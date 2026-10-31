/** Catalog ids such as `paper-cp:2015-5-29/5` mean nothing to an editor. */
export const readableName = (name: string): string => (/^[\w-]+:[\w./-]+$/.test(name) ? '' : name);
