import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Anthropic();

// 57 target locale keys: 53 base codes + 4 full-locale exceptions
const LOCALES = {
	af: 'Afrikaans',
	ar: 'Arabic',
	az: 'Azerbaijani',
	bg: 'Bulgarian',
	bn: 'Bengali',
	bs: 'Bosnian',
	ca: 'Catalan',
	cs: 'Czech',
	da: 'Danish',
	de: 'German',
	el: 'Greek',
	en: 'English',
	eo: 'Esperanto',
	es: 'Spanish',
	et: 'Estonian',
	fa: 'Persian',
	fi: 'Finnish',
	fr: 'French',
	gl: 'Galician',
	he: 'Hebrew',
	hr: 'Croatian',
	hu: 'Hungarian',
	id: 'Indonesian',
	is: 'Icelandic',
	it: 'Italian',
	ja: 'Japanese',
	ka: 'Georgian',
	km: 'Khmer',
	ko: 'Korean',
	lt: 'Lithuanian',
	lv: 'Latvian',
	mk: 'Macedonian',
	mn: 'Mongolian',
	ms: 'Malay',
	nb: 'Norwegian Bokmål',
	nl: 'Dutch',
	no: 'Norwegian',
	pl: 'Polish',
	pt: 'Portuguese',
	ro: 'Romanian',
	ru: 'Russian',
	sk: 'Slovak',
	sl: 'Slovenian',
	sq: 'Albanian',
	sv: 'Swedish',
	sw: 'Swahili',
	th: 'Thai',
	tl: 'Tagalog',
	tr: 'Turkish',
	uk: 'Ukrainian',
	ur: 'Urdu',
	uz: 'Uzbek',
	vi: 'Vietnamese',
	'zh-CN': 'Simplified Chinese',
	'zh-TW': 'Traditional Chinese',
	'sr-SP': 'Serbian (Latin)',
	'sr-CS': 'Serbian (Cyrillic)',
};

// Already exist — skip generation but include in barrel
const SKIP_GENERATE = new Set(['en', 'pt']);

const sourceJson = JSON.parse(
	readFileSync(join(__dirname, '../src/i18n/en.json'), 'utf8'),
);

async function translateLocale(localeKey, languageName) {
	const prompt =
		`Translate the following JSON values from English to ${languageName}.\n` +
		`Return ONLY a valid JSON object with the same keys and translated values.\n` +
		JSON.stringify(sourceJson, null, 2);

	const response = await client.messages.create({
		model: 'claude-haiku-4-5-20251001',
		max_tokens: 1024,
		messages: [{ role: 'user', content: prompt }],
	});

	const text = response.content[0].text;
	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (!jsonMatch) throw new Error(`No JSON found in response for ${localeKey}`);
	return JSON.parse(jsonMatch[0]);
}

async function run() {
	const localesToProcess = Object.entries(LOCALES).filter(
		([key]) => !SKIP_GENERATE.has(key),
	);

	let succeeded = 0;
	let failed = 0;

	// Process in batches of 5 to avoid rate limits
	for (let i = 0; i < localesToProcess.length; i += 5) {
		const batch = localesToProcess.slice(i, i + 5);
		await Promise.all(
			batch.map(async ([key, name]) => {
				try {
					process.stdout.write(`Translating ${key} (${name})... `);
					const translated = await translateLocale(key, name);
					const outPath = join(__dirname, '../src/i18n', `${key}.json`);
					writeFileSync(outPath, JSON.stringify(translated, null, '\t') + '\n');
					console.log('✓');
					succeeded++;
				} catch (err) {
					console.log(`✗ (${err.message})`);
					failed++;
				}
			}),
		);
	}

	console.log(`\nDone: ${succeeded} succeeded, ${failed} failed.`);

	generateBarrel();
}

function toCamelCase(locale) {
	return locale.replace(/-([A-Za-z])/g, (_, c) => c.toUpperCase());
}

function generateBarrel() {
	const allLocales = Object.keys(LOCALES);

	const importLines = allLocales
		.map((locale) => {
			const varName = toCamelCase(locale);
			return `import ${varName} from './${locale}.json';`;
		})
		.join('\n');

	const exportLines = allLocales
		.map((locale) => {
			const varName = toCamelCase(locale);
			if (locale.includes('-')) {
				return `\t'${locale}': ${varName},`;
			}
			return `\t${varName},`;
		})
		.join('\n');

	const content = `${importLines}\n\nexport const messages = {\n${exportLines}\n};\n`;

	const outPath = join(__dirname, '../src/i18n/index.ts');
	writeFileSync(outPath, content);
	console.log('Generated src/i18n/index.ts');
}

run().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
