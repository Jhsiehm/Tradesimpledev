#!/usr/bin/env python3
"""Evidentiary Clarity — TradeSimple policy signal cards.
Renders portrait hero cards (1200x1500) for each signal, plus a landscape
OG card (1200x630) for link previews. 2x supersample, LANCZOS downscale.

  python3 scripts/gen_signal_card.py          # render everything
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SKILL = "/Users/joshuaugyenlhundruphsiehmetters/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/3953c472-47d6-4ae9-a6df-841053d815d1/27d0f9d9-60d6-4859-8a0f-cecbd2973e01/skills/canvas-design/canvas-fonts"
MEDIA = "/Users/joshuaugyenlhundruphsiehmetters/Documents/TradeSimple v1/public/media"
S = 2

# palette
BG, LIME, LIME_DIM, AMBER = (8, 9, 8), (200, 255, 0), (140, 178, 0), (255, 165, 0)
TEXT, MUTED, FAINT, LINE = (232, 228, 220), (140, 140, 130), (74, 74, 70), (44, 46, 44)

def F(name, size): return ImageFont.truetype(f"{SKILL}/{name}", int(size * S))
serif_b = lambda s: F("CrimsonPro-Bold.ttf", s)
mono    = lambda s: F("IBMPlexMono-Regular.ttf", s)
mono_b  = lambda s: F("IBMPlexMono-Bold.ttf", s)
sans    = lambda s: F("Outfit-Regular.ttf", s)

# ── signal content ─────────────────────────────────────────
SIGNALS = {
    "chips-nvda": {
        "cat": "SEMICONDUCTORS", "exposure": 82,
        "headline": "CHIPS Act appropriations clear committee markup",
        "what": "House Appropriations advanced semiconductor manufacturing grants out of committee markup, funding the next CHIPS disbursement tranche.",
        "tickers": ["NVDA", "AMD", "TSM", "INTC", "AVGO"],
        "why": "Sustained fab-buildout funding extends the capital-expenditure cycle that underwrites data-center GPU demand — the core driver of NVDA revenue.",
        "chain": ["Congress.gov", "Committee markup", "Fab timeline", "NVDA demand"],
        "evidence": [("Congress.gov", "H.R.4521 - committee markup, 2026"),
                     ("USASpending", "CHIPS manufacturing disbursements"),
                     ("SEC 10-K", "NVDA data-center revenue segment")],
        "confidence": 82, "conf_label": "HIGH",
        "counter": "Appropriations are not enacted law — floor timing and reconciliation could stall it. Much of the capex thesis may already be priced into the leaders.",
        "watch": "Floor schedule  ·  reconciliation language  ·  NVDA data-center guidance",
    },
    "clarity-coin": {
        "cat": "CRYPTO / DIGITAL ASSETS", "exposure": 76,
        "headline": "CLARITY Act clears the House on digital-asset rules",
        "what": "The House passed the CLARITY Act, drawing the CFTC–SEC jurisdictional line for digital commodities and sending the bill to the Senate.",
        "tickers": ["COIN", "HOOD", "MSTR", "CME", "MARA"],
        "why": "Clear rules on which tokens are commodities vs. securities reduce the regulatory overhang that has capped U.S. exchange and custody revenue.",
        "chain": ["Congress.gov", "House passage", "CFTC / SEC clarity", "COIN revenue"],
        "evidence": [("Congress.gov", "CLARITY Act - House passage, 2026"),
                     ("Senate Banking", "referral & hearing schedule"),
                     ("SEC 10-K", "COIN transaction-revenue mix")],
        "confidence": 76, "conf_label": "MEDIUM-HIGH",
        "counter": "House passage is not law. The Senate has stalled crypto market-structure before, and reconciliation could narrow the CFTC's remit. Exchange revenue stays volume-cyclical regardless of rules.",
        "watch": "Senate Banking calendar  ·  CFTC rulemaking scope  ·  COIN volume trend",
    },
}

# ── drawing helpers (bound to a draw context) ──────────────
class Canvas:
    def __init__(self, w, h):
        self.W, self.H = w * S, h * S
        self.img = Image.new("RGB", (self.W, self.H), BG)
        self._bg()
        self.d = ImageDraw.Draw(self.img)

    def _bg(self):
        grid = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(grid); step = 40 * S
        for x in range(0, self.W, step): gd.line([(x, 0), (x, self.H)], fill=(255, 255, 255, 5))
        for y in range(0, self.H, step): gd.line([(0, y), (self.W, y)], fill=(255, 255, 255, 5))
        self.img = Image.alpha_composite(self.img.convert("RGBA"), grid).convert("RGB")
        glow = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
        gr = ImageDraw.Draw(glow)
        gr.ellipse([self.W * 0.18, -260 * S, self.W * 0.82, 220 * S], fill=(200, 255, 0, 26))
        glow = glow.filter(ImageFilter.GaussianBlur(120 * S))
        self.img = Image.alpha_composite(self.img.convert("RGBA"), glow).convert("RGB")

    def text(self, x, y, s, font, fill, ls=0):
        if ls:
            cx = x
            for ch in s:
                self.d.text((cx, y), ch, font=font, fill=fill); cx += self.d.textlength(ch, font=font) + ls
            return cx
        self.d.text((x, y), s, font=font, fill=fill); return x + self.d.textlength(s, font=font)

    def textr(self, xr, y, s, font, fill):
        self.d.text((xr - self.d.textlength(s, font=font), y), s, font=font, fill=fill)

    def wrap(self, s, font, maxw):
        words, lines, cur = s.split(), [], ""
        for w in words:
            t = (cur + " " + w).strip()
            if self.d.textlength(t, font=font) <= maxw: cur = t
            else:
                if cur: lines.append(cur)
                cur = w
        if cur: lines.append(cur)
        return lines

    def para(self, x, y, s, font, fill, maxw, lh):
        for ln in self.wrap(s, font, maxw): self.d.text((x, y), ln, font=font, fill=fill); y += lh
        return y

    def brandbar(self, y, MX, RIGHT):
        box = 34 * S
        self.d.rounded_rectangle([MX, y, MX + box, y + box], radius=7 * S, outline=LIME, width=2 * S)
        tb = mono_b(19)
        self.text(MX + box / 2 - self.d.textlength("T", font=tb) / 2, y + box / 2 - 14 * S, "T", tb, LIME)
        self.text(MX + box + 16 * S, y + 4 * S, "TRADESIMPLE", mono_b(20), TEXT, ls=2 * S)
        self.textr(RIGHT, y + 2 * S, "POLICY SIGNAL", mono(15), MUTED)
        self.d.ellipse([RIGHT - 9 * S, y + 26 * S, RIGHT - 1 * S, y + 34 * S], fill=LIME)
        self.textr(RIGHT - 16 * S, y + 22 * S, "LIVE", mono_b(13), LIME)
        return y + box

    def chain(self, x, y, nodes):
        nf, af = mono(19), mono_b(19); cx = x
        for i, n in enumerate(nodes):
            self.text(cx, y, n, nf, TEXT); cx += self.d.textlength(n, font=nf)
            if i < len(nodes) - 1:
                cx += 12 * S; self.text(cx, y, "->", af, LIME); cx += self.d.textlength("->", font=af) + 12 * S

    def chips(self, x, y, tickers):
        cf = mono_b(20); cx = x
        for c in tickers:
            cw = self.d.textlength(c, font=cf) + 30 * S
            self.d.rounded_rectangle([cx, y, cx + cw, y + 40 * S], radius=6 * S, outline=(70, 78, 60), width=2 * S)
            self.text(cx + 15 * S, y + 8 * S, c, cf, TEXT); cx += cw + 12 * S

    def confbar(self, x, y, w, conf, label):
        h = 14 * S
        self.d.rounded_rectangle([x, y, x + w, y + h], radius=h / 2, fill=(30, 33, 28))
        self.d.rounded_rectangle([x, y, x + int(w * conf / 100), y + h], radius=h / 2, fill=LIME)
        self.textr(x + w, y + h + 10 * S, f"{conf} / 100  ·  {label}", mono_b(16), LIME)

    def save(self, w, h, out):
        self.img.resize((w, h), Image.LANCZOS).save(out); print("wrote", out)

# ── portrait hero card ─────────────────────────────────────
def render_portrait(cfg, out):
    c = Canvas(1200, 1500); MX = 76 * S; RIGHT = c.W - MX; COLW = RIGHT - MX
    y = 64 * S
    y = c.brandbar(y, MX, RIGHT) + 26 * S
    c.d.line([(MX, y), (RIGHT, y)], fill=LINE, width=2 * S); y += 30 * S
    ebx = c.text(MX, y, "LEGISALERT", mono_b(15), LIME, ls=1 * S)
    c.text(ebx + 12 * S, y, f"·  {cfg['cat']}  ·  POLICY EXPOSURE {cfg['exposure']}/100", mono(15), MUTED); y += 40 * S
    hl = serif_b(54)
    for ln in c.wrap(cfg["headline"], hl, COLW): c.d.text((MX, y), ln, font=hl, fill=TEXT); y += 60 * S
    y += 22 * S; c.d.line([(MX, y), (RIGHT, y)], fill=LINE, width=2 * S); y += 38 * S

    def sec(idx, label, y):
        c.text(MX, y, idx, mono_b(15), LIME); c.text(MX + 34 * S, y, label, mono_b(15), MUTED, ls=2 * S)
        return y + 30 * S

    y = sec("01", "WHAT HAPPENED", y); y = c.para(MX, y, cfg["what"], sans(24), TEXT, COLW, 34 * S) + 46 * S
    y = sec("02", "WHO'S EXPOSED", y); c.chips(MX, y, cfg["tickers"]); y += 40 * S + 48 * S
    y = sec("03", "WHY IT MATTERS", y); y = c.para(MX, y, cfg["why"], sans(24), TEXT, COLW, 34 * S) + 46 * S
    y = sec("04", "THE CHAIN", y); c.chain(MX, y, cfg["chain"]); y += 30 * S + 46 * S
    y = sec("05", "EVIDENCE / RECEIPTS", y)
    for src, desc in cfg["evidence"]:
        c.d.rectangle([MX, y + 5 * S, MX + 4 * S, y + 22 * S], fill=LIME_DIM)
        c.text(MX + 16 * S, y, src, mono_b(17), TEXT); c.text(MX + 184 * S, y, desc, mono(17), MUTED); y += 32 * S
    y += 40 * S
    y = sec("06", "CONFIDENCE", y); c.confbar(MX, y, COLW, cfg["confidence"], cfg["conf_label"]); y += 14 * S + 62 * S
    c.d.rectangle([MX, y, MX + 4 * S, y + 128 * S], fill=AMBER)
    c.text(MX + 18 * S, y, "07", mono_b(15), AMBER); c.text(MX + 52 * S, y, "COUNTERARGUMENT", mono_b(15), MUTED, ls=2 * S)
    c.para(MX + 18 * S, y + 32 * S, cfg["counter"], sans(23), (210, 198, 170), COLW - 18 * S, 33 * S); y += 156 * S
    y = sec("08", "WATCH NEXT", y); c.text(MX, y, cfg["watch"], mono(18), TEXT)

    fy = 1500 * S - 96 * S
    c.d.line([(MX, fy), (RIGHT, fy)], fill=LINE, width=2 * S); fy += 18 * S
    c.para(MX, fy, "Research signal only. Not financial advice. Transparent scenario model — live Congress.gov text supersedes the UI when they disagree.", sans(15.5), MUTED, COLW, 22 * S)
    fy += 50 * S; c.text(MX, fy, "tradesimple.app", mono_b(15), LIME); c.textr(RIGHT, fy, "DATA MAY BE DELAYED", mono(13), FAINT)
    c.save(1200, 1500, out)

# ── landscape OG card (1200x630) ───────────────────────────
def render_og(cfg, out):
    c = Canvas(1200, 630); MX = 64 * S; RIGHT = c.W - MX; COLW = RIGHT - MX
    y = 50 * S
    y = c.brandbar(y, MX, RIGHT) + 22 * S
    c.d.line([(MX, y), (RIGHT, y)], fill=LINE, width=2 * S); y += 26 * S
    ebx = c.text(MX, y, "LEGISALERT", mono_b(15), LIME, ls=1 * S)
    c.text(ebx + 12 * S, y, f"·  {cfg['cat']}  ·  EXPOSURE {cfg['exposure']}/100", mono(15), MUTED); y += 38 * S
    hl = serif_b(58)
    for ln in c.wrap(cfg["headline"], hl, COLW): c.d.text((MX, y), ln, font=hl, fill=TEXT); y += 64 * S
    y += 14 * S
    c.text(MX, y, "WHY IT MATTERS", mono_b(13), MUTED, ls=2 * S); y += 26 * S
    y = c.para(MX, y, cfg["why"], sans(22), (210, 206, 198), COLW, 31 * S) + 26 * S
    c.chain(MX, y, cfg["chain"]); y += 30 * S + 30 * S
    c.chips(MX, y, cfg["tickers"][:5])
    # confidence readout on the right of the chips row
    cw = COLW * 0.42
    c.confbar(RIGHT - cw, y - 2 * S, cw, cfg["confidence"], cfg["conf_label"])
    fy = 630 * S - 70 * S
    c.d.line([(MX, fy), (RIGHT, fy)], fill=LINE, width=2 * S); fy += 16 * S
    c.text(MX, fy, "tradesimple.app", mono_b(15), LIME)
    c.text(MX + 200 * S, fy, "The policy intelligence layer between Washington and Wall Street.", sans(15), MUTED)
    c.textr(RIGHT, fy, "Research signal · not advice", mono(13), FAINT)
    c.save(1200, 630, out)

if __name__ == "__main__":
    render_portrait(SIGNALS["chips-nvda"], f"{MEDIA}/signal-card-chips-nvda.png")
    render_portrait(SIGNALS["clarity-coin"], f"{MEDIA}/signal-card-clarity-coin.png")
    render_og(SIGNALS["chips-nvda"], f"{MEDIA}/og-image.png")
