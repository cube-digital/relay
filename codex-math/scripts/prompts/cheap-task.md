Append the following section to `README.md`, exactly as written, then stop and reply with the single word DONE.

## Exporting

Run `node -e "import('./src/csv.mjs').then(m => console.log(m.toCsv([{ id: 1 }], [{ key: 'id', header: 'id' }])))"` to print a one-row CSV. Amounts are integers in cents; use `moneyColumn` for them.
