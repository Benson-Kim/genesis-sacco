import { fmtAmount, fmtDateTime, fmtKes, initials } from "../format";

/**
 * Hand-computed oracles (MASTER_PROMPT §4 — never captured from the
 * implementation under test).
 */
describe("fmtAmount — string-only money rendering (P15 blocker (a))", () => {
    it("groups thousands by pure string transformation", () => {
        //   1234567.89 → "1,234,567.89": groups of three counted by hand from
        // the right of the integer part (1|234|567), fraction untouched.
        expect(fmtAmount("1234567.89")).toBe("1,234,567.89");
        // 1000 → "1,000" (one group boundary after the leading 1).
        expect(fmtAmount("1000")).toBe("1,000");
        // 999.5 → no grouping below four integer digits; fraction verbatim.
        expect(fmtAmount("999.5")).toBe("999.5");
        // 0.00 → zero stays un-grouped, trailing zeros PRESERVED verbatim
        // (a float round-trip would collapse them — proof no Number() ran).
        expect(fmtAmount("0.00")).toBe("0.00");
    });

    it("preserves signs and precision a float round-trip would destroy", () => {
        expect(fmtAmount("-2500000.00")).toBe("-2,500,000.00");
        // 18 digits exceed IEEE-754 exact integer range (2^53 ≈ 9.007e15):
        // correct output proves the value was never coerced to a number.
        expect(fmtAmount("123456789012345678.99")).toBe("123,456,789,012,345,678.99");
    });

    it("renders unexpected shapes verbatim instead of coercing", () => {
        expect(fmtAmount("n/a")).toBe("n/a");
        expect(fmtAmount("1,234")).toBe("1,234");
    });

    it("labels KES via fmtKes", () => {
        expect(fmtKes("54000.00")).toBe("KES 54,000.00");
    });
});

describe("fmtDateTime", () => {
    it("falls back to em-dash for empty and verbatim for unparseable", () => {
        expect(fmtDateTime(null)).toBe("—");
        expect(fmtDateTime(undefined)).toBe("—");
        expect(fmtDateTime("")).toBe("—");
        expect(fmtDateTime("not-a-date")).toBe("not-a-date");
    });

    it("formats a real ISO instant", () => {
        // Oracle: 2026-01-15T09:30:00Z rendered by en-KE contains day 15,
        // "Jan" and year 2026 (exact time-of-day depends on TZ, so assert
        // the date parts only).
        const rendered = fmtDateTime("2026-01-15T09:30:00Z");
        expect(rendered).toContain("15");
        expect(rendered).toContain("Jan");
        expect(rendered).toContain("2026");
    });
});

describe("initials", () => {
    it("uppercases the first letters of the first two words", () => {
        expect(initials("Amina Odhiambo")).toBe("AO");
        expect(initials("brian")).toBe("B");
        expect(initials("")).toBe("·");
    });
});

