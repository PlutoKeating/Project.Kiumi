#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { crawlAssets, crawlCatalog, loadCatalog, type HouseFloor } from '@kiumi/catalog';
import { summarizeIssues, validateHtml, type Issue } from '@kiumi/core';
import { DocumentBuilder, KiumiClient, markdownToNodes } from '@kiumi/sdk';

const program = new Command();

program
  .name('kiumi')
  .description('WeChat article layout toolkit: crawl templates, compose documents, render HTML')
  .version('0.1.0')
  .option('--data-dir <dir>', 'catalog directory', process.env.KIUMI_DATA_DIR ?? './data');

function dataDir(): string {
  return program.opts().dataDir as string;
}

function client(): KiumiClient {
  return new KiumiClient({ dataDir: dataDir() });
}

function parseSets(raw: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of raw ?? []) {
    const index = item.indexOf('=');
    if (index <= 0) throw new Error(`--set expects key=value, got "${item}"`);
    out[item.slice(0, index)] = item.slice(index + 1);
  }
  return out;
}

function printIssues(issues: Issue[]): void {
  const { errors, warnings, infos } = summarizeIssues(issues);
  for (const issue of issues) {
    const stream = issue.level === 'error' ? console.error : console.warn;
    stream(`  [${issue.level}] ${issue.rule}: ${issue.message}${issue.selector ? ` (${issue.selector})` : ''}`);
  }
  console.error(`  ${errors} error(s), ${warnings} warning(s), ${infos} info`);
}

async function emit(html: string, out: string | undefined, pretty: boolean): Promise<void> {
  const text = pretty ? beautify(html) : html;
  if (out) {
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await writeFile(out, text, 'utf8');
    console.error(`wrote ${out} (${Buffer.byteLength(text, 'utf8')} bytes)`);
  } else {
    process.stdout.write(`${text}\n`);
  }
}

/** Newline between sibling components; keeps generated HTML readable. */
function beautify(html: string): string {
  return html.replace(/></g, '>\n<');
}

// ---------------------------------------------------------------------------
// crawl
// ---------------------------------------------------------------------------

const crawl = program.command('crawl').description('fetch templates, skeletons and assets');

interface CrawlFlags {
  rps?: string;
  concurrency?: string;
  limit?: string;
  cookie?: string;
  publicOnly?: boolean;
  noSkeletons?: boolean;
  assets?: boolean;
}

function crawlOptions(flags: CrawlFlags) {
  const cookie = flags.cookie ?? process.env.XIUMI_COOKIE;
  return {
    dataDir: dataDir(),
    rps: flags.rps ? Number(flags.rps) : 3,
    cookie: cookie || undefined,
    includeObsolete: !flags.publicOnly,
    fetchMissingSkeletons: !flags.noSkeletons,
    log: (line: string) => console.error(line),
  };
}

crawl
  .command('templates')
  .description('fetch the catalog (rooms, items, skeletons)')
  .option('--rps <n>', 'requests per second')
  .option('--cookie <cookie>', 'cookie header for member-only houses (or XIUMI_COOKIE)')
  .option('--public-only', 'skip entries marked Obsolete')
  .option('--no-skeletons', 'do not fill missing skeletons from the CDN')
  .option('--house <house>', 'restrict to one house')
  .action(async (flags) => {
    const sources = flags.house
      ? ([{ house: flags.house, floor: 'comp' }] as HouseFloor[])
      : undefined;
    const report = await crawlCatalog({ ...crawlOptions(flags), sources });
    console.log(
      JSON.stringify(
        {
          templates: report.templates,
          rooms: report.rooms,
          skeletons: report.skeletons,
          missingSkeletons: report.missingSkeletons.length,
          skippedRooms: report.skippedRooms.length,
          errors: report.sources.flatMap((source) => source.errors),
        },
        null,
        2,
      ),
    );
  });

crawl
  .command('assets')
  .description('mirror template images and svg assets')
  .option('--concurrency <n>', 'parallel downloads', '4')
  .option('--rps <n>', 'requests per second')
  .option('--limit <n>', 'stop after N assets (0 = all)')
  .action(async (flags) => {
    const result = await crawlAssets({
      dataDir: dataDir(),
      concurrency: Number(flags.concurrency ?? 4),
      rps: flags.rps ? Number(flags.rps) : 4,
      limit: flags.limit ? Number(flags.limit) : 0,
      cookie: process.env.XIUMI_COOKIE || undefined,
      log: (line) => console.error(line),
    });
    console.log(JSON.stringify(result, null, 2));
  });

crawl
  .command('all')
  .description('templates then assets')
  .option('--rps <n>', 'requests per second')
  .option('--concurrency <n>', 'parallel asset downloads', '4')
  .option('--limit <n>', 'stop after N assets (0 = all)')
  .option('--cookie <cookie>', 'cookie header (or XIUMI_COOKIE)')
  .option('--public-only', 'skip entries marked Obsolete')
  .option('--no-skeletons', 'do not fill missing skeletons from the CDN')
  .action(async (flags) => {
    const report = await crawlCatalog(crawlOptions(flags));
    const assets = await crawlAssets({
      dataDir: dataDir(),
      concurrency: Number(flags.concurrency ?? 4),
      rps: flags.rps ? Number(flags.rps) : 4,
      limit: flags.limit ? Number(flags.limit) : 0,
      cookie: flags.cookie ?? process.env.XIUMI_COOKIE ?? undefined,
      log: (line) => console.error(line),
    });
    console.log(
      JSON.stringify(
        {
          templates: report.templates,
          rooms: report.rooms,
          skeletons: report.skeletons,
          skippedRooms: report.skippedRooms.length,
          assets,
        },
        null,
        2,
      ),
    );
  });

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------

program
  .command('stats')
  .description('catalog summary')
  .option('--json', 'machine readable')
  .action(async (flags) => {
    const catalog = await loadCatalog(dataDir());
    const byRoom = new Map<string, number>();
    let svg = 0;
    let animated = 0;
    let bytes = 0;
    for (const entry of catalog.index) {
      byRoom.set(entry.room, (byRoom.get(entry.room) ?? 0) + 1);
      if (entry.hasSvg) svg++;
      if (entry.hasAnimation) animated++;
      bytes += entry.byteSize;
    }
    const summary = {
      templates: catalog.index.length,
      rooms: catalog.rooms.length,
      skeletons: Object.keys(catalog.skeletons).length,
      hasSvg: svg,
      hasAnimation: animated,
      totalBytes: bytes,
      byRoom: Object.fromEntries([...byRoom.entries()].sort()),
    };
    if (flags.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    console.log(`templates   ${summary.templates}`);
    console.log(`rooms       ${summary.rooms}`);
    console.log(`skeletons   ${summary.skeletons}`);
    console.log(`with svg    ${summary.hasSvg}`);
    console.log(`animated    ${summary.hasAnimation}`);
    console.log(`body bytes  ${summary.totalBytes}`);
    console.log('');
    for (const [room, count] of Object.entries(summary.byRoom)) {
      console.log(`  ${room.padEnd(30)} ${count}`);
    }
  });

program
  .command('list')
  .description('list templates')
  .option('--room <tag>', 'filter by room tag')
  .option('--q <text>', 'filter by name or id')
  .option('--has-svg', 'only templates containing svg')
  .option('--limit <n>', 'page size', '30')
  .option('--offset <n>', 'page offset', '0')
  .option('--json', 'machine readable')
  .action(async (flags) => {
    const result = await client().list({
      room: flags.room,
      q: flags.q,
      hasSvg: flags.hasSvg ? true : undefined,
      limit: Number(flags.limit),
      offset: Number(flags.offset),
    });
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    for (const item of result.items) {
      const flagsText = [item.hasSvg ? 'svg' : '', item.hasAnimation ? 'anim' : '']
        .filter(Boolean)
        .join(',');
      console.log(
        `${item.atomTplId.padEnd(40)} ${String(item.byteSize).padStart(7)}B  ${flagsText.padEnd(9)} ${item.displayName}`,
      );
    }
    console.log(`\n${result.items.length} of ${result.total}`);
  });

program
  .command('show <atomTplId>')
  .description('show one template')
  .option('--html', 'print rendered html')
  .option('--matrix', 'print the structured matrix')
  .option('--json', 'print the full record')
  .action(async (atomTplId, flags) => {
    const record = await client().get(atomTplId);
    if (!record) {
      console.error(`TEMPLATE_NOT_FOUND: ${atomTplId}`);
      process.exitCode = 1;
      return;
    }
    if (flags.json) {
      console.log(JSON.stringify(record, null, 2));
      return;
    }
    if (flags.matrix) {
      console.log(JSON.stringify(record.matrix, null, 2));
      return;
    }
    if (flags.html) {
      console.log(record.html);
      return;
    }
    console.log(`id          ${record.atomTplId}`);
    console.log(`name        ${record.displayName}`);
    console.log(`room        ${record.room}`);
    console.log(`access      ${record.accessibility}`);
    console.log(`version     ${record.version ?? '-'}`);
    console.log(`svg         ${record.hasSvg}`);
    console.log(`animation   ${record.hasAnimation}`);
    console.log(`bytes       ${record.byteSize}`);
    console.log(`tplIds      ${record.tplIds.length}`);
    console.log(`slots       ${(await client().slots(atomTplId)).join(', ') || '-'}`);
    console.log(`assets      ${record.assetUrls.length}`);
  });

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

program
  .command('render [file]')
  .description('render a document json, or a template with --tpl')
  .option('--tpl <atomTplId>', 'render a library template instead of a document')
  .option('--set <kv...>', 'slot override, repeatable (temporary, not saved)')
  .option('-o, --out <file>', 'write html to a file')
  .option('--pretty', 'insert newlines between sibling tags')
  .option('--json', 'print {html, bytes, issues}')
  .option('--no-validate', 'skip the WeChat compatibility check')
  .action(async (file, flags) => {
    const kiumi = client();
    const sets = parseSets(flags.set);
    let html: string;
    let warnings: unknown[] = [];

    if (flags.tpl) {
      const filled = await kiumi.fill(flags.tpl, sets);
      html = filled.html;
      warnings = filled.warnings;
    } else {
      if (!file) throw new Error('render needs a document file or --tpl');
      const raw = await readFile(file, 'utf8');
      const doc = JSON.parse(raw);
      const result = await kiumi.renderDocument(doc);
      html = result.html;
      warnings = result.warnings;
    }

    const issues = flags.validate === false ? [] : validateHtml(html);

    if (flags.json) {
      console.log(
        JSON.stringify({ html, bytes: Buffer.byteLength(html, 'utf8'), warnings, issues }, null, 2),
      );
    } else {
      await emit(html, flags.out, Boolean(flags.pretty));
    }

    if (warnings.length) console.error(`  ${warnings.length} render warning(s)`);
    if (issues.length) printIssues(issues);
    if (issues.some((issue) => issue.level === 'error')) process.exitCode = 1;
  });

program
  .command('fill <atomTplId>')
  .description('produce a one-block document with slots filled')
  .option('--set <kv...>', 'slot override, repeatable')
  .option('-o, --out <file>', 'write document json')
  .action(async (atomTplId, flags) => {
    const kiumi = client();
    const record = await kiumi.get(atomTplId);
    if (!record) {
      console.error(`TEMPLATE_NOT_FOUND: ${atomTplId}`);
      process.exitCode = 1;
      return;
    }
    const sets = parseSets(flags.set);
    const builder = DocumentBuilder.create(record.displayName).addLibraryBlock(record);
    if (Object.keys(sets).length) builder.fillBlock(0, sets);
    const json = JSON.stringify(builder.toJSON(), null, 2);
    if (flags.out) {
      await writeFile(flags.out, `${json}\n`, 'utf8');
      console.error(`wrote ${flags.out}`);
    } else {
      process.stdout.write(`${json}\n`);
    }
  });

program
  .command('md <file>')
  .description('convert a markdown file into a document json')
  .option('--title <title>', 'override the document title')
  .option('-o, --out <file>', 'write document json')
  .action(async (file, flags) => {
    const source = file === '-' ? await readStdin() : await readFile(file, 'utf8');
    const parsed = markdownToNodes(source);
    const title =
      flags.title ?? parsed.title ?? path.basename(file).replace(/\.md$/i, '') ?? '未命名图文';
    const builder = DocumentBuilder.create(title);
    for (const node of parsed.nodes) builder.addNativeBlock(node);
    const json = JSON.stringify(builder.toJSON(), null, 2);
    if (flags.out) {
      await writeFile(flags.out, `${json}\n`, 'utf8');
      console.error(`wrote ${flags.out} (${parsed.nodes.length} blocks)`);
    } else {
      process.stdout.write(`${json}\n`);
    }
  });

program
  .command('validate <file>')
  .description('check rendered html against WeChat constraints')
  .option('--json', 'machine readable')
  .option('--max-bytes <n>', 'byte budget', '20000')
  .action(async (file, flags) => {
    const html = file === '-' ? await readStdin() : await readFile(file, 'utf8');
    const issues = validateHtml(html, { maxBytes: Number(flags.maxBytes) });
    if (flags.json) {
      console.log(JSON.stringify({ bytes: Buffer.byteLength(html, 'utf8'), issues }, null, 2));
    } else {
      printIssues(issues);
    }
    if (issues.some((issue) => issue.level === 'error')) process.exitCode = 1;
  });

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`error: ${(error as Error).message}`);
  process.exitCode = 1;
});
