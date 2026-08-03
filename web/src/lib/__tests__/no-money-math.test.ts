/**
    * P15 merge blocker(a) — NO client - side money math EVER: installment
        * previews, cover %, capacities, balances and settlement figures come
            * from the API as decimal strings; a locally computed money figure is a
                * rejected MR.This grep gate scans every web source file for numeric
                    * coercion or arithmetic applied to money - named identifiers.
   *
   * Falsifiability: the gate is proven non - vacuous below by asserting it
    * flags synthetic offending samples(removing the guard regexes fails
        * that assertion).
   */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const WEB_ROOT = join(__dirname, "..", "..");
const SCAN_ROOTS = [join(WEB_ROOT, "src"), join(WEB_ROOT, "packages")];
const EXTENSIONS = [".ts", ".tsx"];
const SELF = join("src", "__tests__", "no-money-math.test.ts");

/** Identifiers that carry money values in the API contract. */
const MONEY_FIELDS = [
    "amount",
    "balance",
    "deposits",
    "disbursements",
    "share_capital",
    "outstanding",
    "provisions",
    "penalties",
    "pledged",
    "npl",
    "par30",
    "settlement",
    "principal",
    "installment",
    "total",
] as const;

const MONEY_GROUP = `(?:${MONEY_FIELDS.join("|")})`;

/**
 * Offending shapes (case-insensitive):
 *  - numeric coercion of a money-named identifier/property:
 *      parseFloat(x.balance), Number(totalDeposits), +row.amount
 *  - arithmetic between money-named identifiers/properties:
 *      a.balance - b.amount, outstanding * rate
 */
const GATES: readonly { name: string; regex: RegExp }[] = [
    {
        name: "numeric coercion of a money field",
        regex: new RegExp(
            `(?:parseFloat|parseInt|Number)\\s*\\(\\s*[\\w.]*${MONEY_GROUP}`,
            "i",
        ),
    },
    {
        name: "unary-plus coercion of a money field",
        regex: new RegExp(`[=(,\\[{]\\s*\\+\\s*[\\w.]*${MONEY_GROUP}[\\w.]*\\b`, "i"),
    },
    {
        name: "arithmetic on a money field",
        regex: new RegExp(
            `[\\w.]*${MONEY_GROUP}[\\w.]*\\s*[-+*/%]\\s*[\\w.$]`,
            "i",
        ),
    },
];

function collectFiles(root: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(root)) {
        const path = join(root, entry);
        if (statSync(path).isDirectory()) {
            if (entry === "node_modules" || entry === ".next" || entry === "generated") continue;
            files.push(...collectFiles(path));
        } else if (EXTENSIONS.some((ext) => path.endsWith(ext))) {
            files.push(path);
        }
    }
    return files;
}

describe("no client-side money math (P15 blocker (a))", () => {
    const files = SCAN_ROOTS.flatMap((root) => collectFiles(root)).filter(
        (path) => relative(WEB_ROOT, path).split(sep).join("/") !== SELF.split(sep).join("/"),
    );

    it("scans a non-trivial source tree (the gate cannot pass vacuously)", () => {
        expect(files.length).toBeGreaterThan(30);
    });

    it("flags synthetic offenders (the gate itself is falsifiable)", () => {
        const coercion = 'const x = parseFloat(row.balance);';
        const unary = "const y = +row.amount;";
        const arithmetic = "const z = account.balance - txn.amount;";
        expect(GATES[0].regex.test(coercion)).toBe(true);
        expect(GATES[1].regex.test(unary)).toBe(true);
        expect(GATES[2].regex.test(arithmetic)).toBe(true);
    });

    it.each(GATES)("no source file performs $name", ({ regex }) => {
        const offenders: string[] = [];
        for (const path of files) {
            const source = readFileSync(path, "utf8");
            for (const line of source.split("\
  ")) {
                if (regex.test(line)) {
                    offenders.push(`${relative(WEB_ROOT, path)}: ${line.trim()}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});

