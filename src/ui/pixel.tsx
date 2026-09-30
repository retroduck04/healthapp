// 12 × 12 pixel icons for generic foods, drawn in the MAGI palette (no brand marks: food types only).

export type IconName =
  | "burger" | "chicken-sandwich" | "pizza" | "drumstick" | "wings" | "nuggets" | "coffee" | "iced" | "donut" | "timbits"
  | "taco" | "burrito" | "bowl" | "icecream" | "shake" | "fries" | "rings" | "poutine" | "drink" | "hotdog" | "croissant"
  | "bagel" | "muffin" | "pie" | "bread" | "chips" | "soup" | "cake";

const INK: Record<string, string> = {
  a: "var(--am)",
  o: "var(--or)",
  r: "var(--red)",
  w: "var(--wht)",
  g: "var(--grn)",
  y: "var(--yel)",
  b: "var(--r3)",
  c: "var(--cya)",
  d: "var(--dim)",
  s: "var(--gry)",
};

// Rows are 12 characters; "." is transparent.
const ICONS: Record<IconName, string[]> = {
  burger: ["............", "...aaaaaa...", "..aawaawaa..", ".aaaaaaaaaa.", ".gggggggggg.", ".yyyyyyyyyy.", ".bbbbbbbbbb.", ".bbbbbbbbbb.", ".aaaaaaaaaa.", "..aaaaaaaa..", "............", "............"],
  "chicken-sandwich": ["............", "...aaaaaa...", "..aawaawaa..", ".aaaaaaaaaa.", ".gggggggggg.", "oooooooooooo", ".oaooaooaoo.", "oooooooooooo", ".aaaaaaaaaa.", "..aaaaaaaa..", "............", "............"],
  pizza: ["............", ".oooooooooo.", ".oyyyyyyyyo.", "..yryyyryy..", "..yyyyyyyy..", "...yyryyy...", "...yyyyyy...", "....yyry....", "....yyyy....", ".....yy.....", ".....yy.....", "............"],
  drumstick: ["............", "....oooo....", "...oaaaao...", "..oaaoaaao..", "..oaaaaaao..", "..oaaaaoao..", "...oaaaao...", "....oaao....", ".....ww.....", ".....ww.....", "....w..w....", "............"],
  wings: ["............", ".ooo....ooo.", "oaaao..oaaao", "oaoao..oaaao", "oaaao..oaoao", ".oaaw..waao.", "..oww..wwo..", "...w....w...", "............", "..ooo.......", ".oaaaoooo...", "..wwoaaaao.."],
  nuggets: ["............", ".aaa...aaa..", "aaoaa.aaaoa.", "aaaaa.aaaaa.", ".aaa...aaa..", "............", "...aaaaa....", "..aaoaaaa...", "..aaaaaoa...", "...aaaaa....", "............", "............"],
  coffee: ["....w..w....", ".....w..w...", "....w..w....", "..oooooooo..", "..oooooooo..", "...aaaaaa...", "...wwwwww...", "...wwwwww...", "...aaaaaa...", "....aaaa....", "....aaaa....", "............"],
  iced: ["......w.....", "......w.....", ".....w......", "..wwwwwwww..", "..wwwwwwww..", "..aaaaaaaa..", "...awaawa...", "...aaaaaa...", "...aaaaaa...", "....aaaa....", "....aaaa....", "............"],
  donut: ["............", "...oooooo...", "..owawawwo..", ".owwwwwwwwo.", ".owww..wwao.", ".oaw....wao.", ".oaww..wwao.", ".oaaaaaaaao.", "..oaaaaaao..", "...oooooo...", "............", "............"],
  timbits: ["............", "..ww....aa..", ".wwww..aaaa.", ".wwww..aaaa.", "..ww....aa..", "............", "....oo......", "...oooo..ww.", "...oooo.wwww", "....oo..wwww", ".........ww.", "............"],
  taco: ["............", "............", "............", "...yyyyyy...", "..yggrggry..", ".yggrggrggy.", ".yrgggrgggy.", ".yyyyyyyyyy.", "..yyyyyyyy..", "............", "............", "............"],
  burrito: ["............", "....wwww....", "...wwwwww...", "...aaaaaa...", "..aaaaaaaa..", "..aaoaaaaa..", "..aaaaaoaa..", "..aaaaaaaa..", "..wwwwwwww..", "...wwwwww...", "............", "............"],
  bowl: ["............", "............", "...g.r.y....", "..gyrgyrgg..", ".gggyyrrggg.", ".wwwwwwwwww.", ".wwwwwwwwww.", "..wwwwwwww..", "...wwwwww...", "....wwww....", "............", "............"],
  icecream: ["....wwww....", "...wwwwww...", "..wwwwwwww..", "..wwwwwwww..", "...aaaaaa...", "...aoaoaa...", "....aoao....", "....aaaa....", ".....ao.....", ".....aa.....", "............", "............"],
  shake: ["......w.....", ".....w......", "...wwwwww...", "..wwwwwwww..", "..oooooooo..", "...wwwwww...", "...wbwwww...", "...wwwwbw...", "....wwww....", "....wwww....", "............", "............"],
  fries: ["............", "..y.y.y.y...", "..yyy.yyyy..", "..yyyyyyyy..", "..yyyyyyyy..", ".oooooooooo.", ".oooooooooo.", ".oooddddooo.", ".oooooooooo.", "..oooooooo..", "..oooooooo..", "............"],
  rings: ["............", "..aaaa......", ".aa..aa.....", ".a....a.....", ".aa..aaaaa..", "..aaaaa..aa.", ".....a....a.", ".....aa..aa.", "......aaaa..", "............", "............", "............"],
  poutine: ["............", "..y.y..y....", "..yyywyyyy..", ".yybbbwbyyy.", ".ybwbbbbbwy.", ".oooooooooo.", ".oooooooooo.", "..oooooooo..", "..oooooooo..", "...oooooo...", "............", "............"],
  drink: ["......w.....", "......w.....", ".....w......", "..oooooooo..", "..cccccccc..", "...cwcccc...", "...cccccc...", "...cccccc...", "....cccc....", "....cccc....", "............", "............"],
  hotdog: ["............", "............", "............", "..aaaaaaaa..", ".abbbbbbbba.", "ayybyybyyyya", ".abbbbbbbba.", "..aaaaaaaa..", "............", "............", "............", "............"],
  croissant: ["............", "............", "............", "..a......a..", ".aa.aaaa.aa.", ".aaaoaaoaaa.", "..aaoaaoaa..", "...aaaaaa...", "............", "............", "............", "............"],
  bagel: ["............", "...aaaaaa...", "..aawawwaa..", ".aawwaawwaa.", ".aaa....aaa.", ".aaa....aaa.", ".aawaawawaa.", "..aaaaaaaa..", "...aaaaaa...", "............", "............", "............"],
  muffin: ["............", "............", "...aaaaaa...", "..aaaaaaaa..", ".yyyyyyyyyy.", ".bbbbbbbbbb.", ".wwwwwwwwww.", "..aaaaaaaa..", "...aaaaaa...", "............", "............", "............"],
  pie: ["............", "............", "...oooooo...", "..oaoaoaoo..", ".oaaaaaaaao.", ".oooooooooo.", "..bbbbbbbb..", "..oooooooo..", "............", "............", "............", "............"],
  bread: ["............", "..aaaaaaaa..", ".aaaaaaaaaa.", ".awwwwwwwwa.", ".awwwwwwwwa.", ".awwwwwwwwa.", ".awwwwwwwwa.", ".aaaaaaaaaa.", "............", "............", "............", "............"],
  chips: ["............", "....y.......", "...yyy..y...", "..yyyyyyyy..", "..yyyyyyyyy.", ".oooooooooo.", ".oooooooooo.", "..oooooooo..", "...oooooo...", "............", "............", "............"],
  soup: ["....w..w....", ".....w..w...", "............", ".oooooooooo.", ".oayagayaao.", ".oooooooooo.", "..oooooooo..", "...oooooo...", "............", "............", "............", "............"],
  cake: ["............", ".....r......", "....wwww....", "...bbbbbb...", "...wwwwww...", "...bbbbbb...", "...bbbbbb...", "..ssssssss..", "............", "............", "............", "............"],
};

/** Horizontal runs of one colour, so an icon is a handful of rects instead of 144. */
const RUNS: Record<string, { x: number; y: number; w: number; c: string }[]> = {};
function runsOf(name: IconName) {
  if (RUNS[name]) return RUNS[name];
  const out: { x: number; y: number; w: number; c: string }[] = [];
  ICONS[name].forEach((row, y) => {
    let x = 0;
    while (x < 12) {
      const ch = row[x] ?? ".";
      let w = 1;
      while (x + w < 12 && row[x + w] === ch) w++;
      if (ch !== "." && INK[ch]) out.push({ x, y, w, c: INK[ch] });
      x += w;
    }
  });
  return (RUNS[name] = out);
}

export function PixelIcon(props: { name: IconName; size?: number; className?: string }) {
  const size = props.size ?? 24;
  return (
    <svg className={props.className ? `px-icon ${props.className}` : "px-icon"} viewBox="0 0 12 12" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {runsOf(props.name).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} />
      ))}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(ICONS) as IconName[];
