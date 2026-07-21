# API Autofill for Directus

A general-purpose Directus interface that queries an external HTTP API as the user types and autofills sibling fields from the response. Configure the endpoint, the trigger, and a source-to-target field mapping entirely from the collection editor — no code required.

Typing a postal code fills street, city and state. Typing a tax ID fills a company's legal name and address. Typing a SKU fills description and price. Same extension, different configuration.

## Features

- **Any JSON API** — GET or POST, custom headers, optional request body
- **Liquid templating** — shape the outbound request (URL, headers, body) with [Liquid](https://liquidjs.com) filters like `upcase`, `json`, and `url_encode`
- **Field mapping** — map any dot-path in the API response (`data.address.city`) to any field in the collection
- **Server-side proxy** — the browser never sees the target URL, headers, or credentials
- **Secrets stay on the server** — reference environment variables with `{{env.VAR}}`; they are resolved inside the Directus process
- **Permission-aware** — every lookup runs under the requesting user's own field permissions
- **Debounced** — configurable delay (default 500 ms) with duplicate-search suppression
- **Trigger regex** — fire the lookup only when the input matches a pattern, so partial typing costs nothing
- **Fails quietly** — upstream errors surface as an inline notice; existing field values are never wiped

## Installation

### Via Directus Marketplace (Recommended)

1. Navigate to your Directus project
2. Go to **Settings** → **Extensions**
3. Search for "**API Autofill**"
4. Click **Install**

> [!IMPORTANT]
> This bundle contains a **non-sandboxed API extension** — the endpoint performs outbound HTTP requests on your behalf, which the Directus sandbox does not permit. Your instance must be configured with `MARKETPLACE_TRUST=all` for it to appear in and install from the Marketplace. The default, `MARKETPLACE_TRUST=sandbox`, hides non-sandboxed API extensions.

### Via npm

```bash
npm install @ribertec/directus-extension-api-autofill
```

Then restart your Directus instance.

## Setup

This bundle contains two entries that work as a pair — an interface you configure on a field, and an endpoint that performs the lookup. Install both (they ship together); only the interface needs configuration.

### 1. API Autofill (`api-autofill-input`)

An interface for `string` and `text` fields. Apply it to the field the user types into (the postal code, the SKU, the document number), then add the fields it should fill as ordinary sibling fields in the same collection.

| Option               | Description                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Request URL          | The endpoint to call. Rendered with [Liquid](https://liquidjs.com): `{{ value }}` is the typed text, `{{ env.VAR }}` a server env var. The value is **not** auto-encoded — use `{{ value \| url_encode }}` in query strings |
| Method               | `GET` (default) or `POST`                                                                                                       |
| Headers              | Repeatable name/value pairs. Values are rendered with Liquid — e.g. `Bearer {{ env.API_TOKEN }}` for API keys                   |
| Request Body (JSON)  | POST only. Rendered with Liquid — use `{{ value \| json }}` to embed the value as a valid JSON string. `Content-Type: application/json` is added automatically unless you set it yourself |
| Debounce (ms)        | How long to wait after the last keystroke before searching. Default `500`                                                        |
| Trigger Regex        | Optional. The lookup only fires when the typed value matches this pattern — e.g. `^\d{8}$` for an 8-digit code                   |
| Field Mappings       | Repeatable pairs: **Source path** is a dot-path into the API response (`data.city`), **Target field** is a field in this collection |

The **Request URL**, **Headers**, and **Request Body** are rendered with the [Liquid](https://liquidjs.com) template engine. Two variables are in scope: `value` (the typed text) and `env` (server environment variables). Use Liquid filters to format what you send — for example `{{ value | upcase }}`, `{{ value | url_encode }}` in a query string, or `{{ value | json }}` to embed the value safely in a JSON body. Referencing a variable that is not set — a missing env var or a typo — aborts the lookup with a configuration error.

**Field Mappings** is where the response becomes form data. Source paths are read with dot notation from the root of the JSON response, and array indexes work too (`results.0.name`). A mapping whose source path is missing from the response is skipped, leaving that field untouched.

### 2. API Autofill Endpoint (`api-autofill`)

Registers `POST /api-autofill/search`. It has no options and requires no setup — the interface calls it automatically.

It exists because the lookup must not happen in the browser. See [Security model](#security-model).

## Example — Brazilian postal code (ViaCEP)

Applied to a `cep` field, with `street`, `city` and `state` as siblings:

| Option         | Value                                       |
| -------------- | ------------------------------------------- |
| Request URL    | `https://viacep.com.br/ws/{{ value }}/json/`  |
| Method         | `GET`                                       |
| Trigger Regex  | `^\d{8}$`                                   |

Field Mappings:

| Source path | Target field |
| ----------- | ------------ |
| `logradouro` | `street`    |
| `localidade` | `city`      |
| `uf`         | `state`     |

## Example — authenticated API

| Option      | Value                                          |
| ----------- | ---------------------------------------------- |
| Request URL | `https://api.example.com/lookup?q={{ value \| url_encode }}` |
| Headers     | `Authorization` → `Bearer {{ env.API_TOKEN }}` |

`API_TOKEN` is read from the Directus process environment at request time. The token is never sent to the browser and never stored in the field configuration.

## Security model

The interface sends only `{ collection, field, value }` to the endpoint. Everything else — URL, method, headers, body — is read server-side from the field's stored configuration. A user cannot point the proxy at an arbitrary host by tampering with the request, because the request does not carry a host.

Each lookup additionally:

- **Requires authentication** — anonymous requests are rejected with `401`
- **Reads the field under the caller's own accountability** — if the user cannot read the field, the lookup returns `403`
- **Verifies the field actually uses this interface** — otherwise `400`, so the endpoint cannot be used as an open proxy via unrelated fields
- **Times out after 10 seconds**, returning `504`

Upstream failures return `502` and the user sees a generic notice. Errors are not echoed back verbatim, so upstream responses cannot leak into the Data Studio.

> [!NOTE]
> Configuration is trusted. Anyone who can edit field settings (administrators, by default) can point the URL at any host reachable from the Directus server and template `{{ env.VAR }}` into it. Treat the field-configuration permission as equivalent to server-side request access, and restrict it accordingly.

### Request body escaping

Embed the typed value in a JSON body with the Liquid `json` filter: `{{ value | json }}` outputs a properly quoted, escaped JSON string, so a value containing `"` or `\` still produces a valid body. Inserting `{{ value }}` raw into JSON is possible but unsafe for that reason — prefer `{{ value | json }}`.

## Translations

Extension options in the collection editor are always displayed in **English**.

User-facing elements shown in the Data Studio during data entry (such as the error notice when a lookup fails) currently ship with **English** and **Portuguese** translations, selected from your Directus default language setting. Contributions for other languages are welcome — open a pull request on [GitHub](https://github.com/IgorGRibeiro/directus-extension-api-autofill) adding `src/i18n/<locale>.json`.

## Requirements

- Directus 11.0.0+
- `MARKETPLACE_TRUST=all` if installing via the Marketplace (see [Installation](#installation))

## License

MIT License — see [LICENSE](LICENSE) file for details
