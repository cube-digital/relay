Implement a CSV export module in this Node project and make the test suite pass.

Create `src/csv.mjs` exporting:
- `toCsv(rows, columns)`: `rows` is an array of objects, `columns` an array of `{ key, header }`; returns a string with a header line followed by one line per row, lines separated by `\n`, fields separated by `,`. A field that contains a comma, a double quote or a newline is wrapped in double quotes, with inner double quotes doubled (RFC 4180). Missing values render as empty fields.
- `moneyColumn(key, header, currency)`: returns a column whose cell renders the row's integer cents through `format` from `src/money.mjs`.

Add `test/csv.test.mjs` with exactly four tests: a plain two-row export, quoting of a field containing a comma and a quote, an empty value, and a money column rendering `1205` as `12.05 EUR`. Run `npm test` and fix anything that fails. Commit nothing; just leave the files in place and finish with a two-line summary of what you changed and the test result.
