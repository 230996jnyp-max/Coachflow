import type { FoodTag, Macros } from "./nutrition";

/*
 * A built-in list of everyday foods from many cuisines, with typical values per 100 g (cooked or ready to eat unless the name
 * says otherwise). Typical values vary by brand and recipe, so dishes are marked approximate. It makes search instant and
 * free; packaged foods come from Open Food Facts and anything else from the AI.
 */

export interface CommonFood {
  id: string;
  name: string;
  per100: Macros;
  servingLabel: string;
  servingGrams: number;
  contains: FoodTag[];
  /** A prepared dish: values vary a lot between recipes. */
  dish: boolean;
}

const TAG: Record<string, FoodTag> = { pk: "pork", bf: "beef", mt: "meat", fs: "fish", sh: "shellfish", eg: "egg", dy: "dairy", gl: "gluten", pn: "peanut", tn: "tree_nut", sy: "soy", se: "sesame", al: "alcohol" };

// name | kcal | protein | carbs | fat | serving | grams | tags (D = dish)
type Row = [string, number, number, number, number, string, number, string?];

const ROWS: Row[] = [
  // Rice, noodles, bread, grains
  ["White rice, cooked", 130, 2.7, 28.2, 0.3, "1 bowl", 180],
  ["Brown rice, cooked", 123, 2.7, 25.6, 1, "1 bowl", 180],
  ["Fried rice", 170, 4.5, 25, 5.8, "1 plate", 300, "eg sy D"],
  ["Pasta, cooked", 158, 5.8, 30.9, 0.9, "1 cup", 140, "gl"],
  ["Spaghetti bolognese", 150, 7, 16, 6, "1 plate", 350, "gl mt bf D"],
  ["Egg noodles, cooked", 138, 4.5, 25, 2.1, "1 bowl", 200, "gl eg"],
  ["Rice noodles, cooked", 109, 0.9, 25, 0.2, "1 bowl", 200],
  ["White bread", 265, 9, 49, 3.2, "1 slice", 30, "gl"],
  ["Wholemeal bread", 252, 12.5, 43, 3.5, "1 slice", 35, "gl"],
  ["Oats, rolled (dry)", 389, 16.9, 66, 6.9, "½ cup", 40, "gl"],
  ["Oatmeal / porridge, cooked with water", 71, 2.5, 12, 1.5, "1 bowl", 240, "gl"],
  ["Cornflakes", 357, 7.5, 84, 0.4, "1 bowl", 30, "gl"],
  ["Granola", 471, 10, 64, 20, "½ cup", 50, "gl tn"],
  ["Potato, boiled", 87, 1.9, 20, 0.1, "1 medium", 170],
  ["French fries", 312, 3.4, 41, 15, "1 portion", 117],
  ["Sweet potato, baked", 90, 2, 20.7, 0.2, "1 medium", 130],
  ["Quinoa, cooked", 120, 4.4, 21.3, 1.9, "1 cup", 185],
  ["Flour tortilla / wrap", 310, 8, 52, 8, "1 wrap", 60, "gl"],
  ["Naan", 310, 9.7, 50, 5.1, "1 piece", 90, "gl dy"],
  ["Chapati / roti", 297, 9.9, 46, 7.5, "1 piece", 40, "gl"],
  ["Bagel", 257, 10, 50, 1.6, "1 bagel", 100, "gl"],
  ["Croissant", 406, 8.2, 45.8, 21, "1 croissant", 57, "gl dy eg"],
  // Meat, fish, eggs, plant proteins
  ["Chicken breast, cooked, no skin", 165, 31, 0, 3.6, "1 breast", 120, "mt"],
  ["Chicken thigh, cooked, no skin", 209, 26, 0, 10.9, "1 thigh", 100, "mt"],
  ["Fried chicken", 246, 18, 8, 15, "1 piece", 120, "mt gl"],
  ["Beef steak, grilled, lean", 190, 28, 0, 8, "1 steak", 150, "bf mt"],
  ["Ground beef, cooked", 250, 26, 0, 15.5, "1 portion", 100, "bf mt"],
  ["Pork loin, cooked", 195, 28, 0, 8, "1 slice", 100, "pk mt"],
  ["Pork belly", 518, 9.3, 0, 53, "1 portion", 100, "pk mt"],
  ["Bacon, cooked", 541, 37, 1.4, 42, "1 slice", 8, "pk mt"],
  ["Lamb, roasted", 258, 25, 0, 17, "1 portion", 100, "mt"],
  ["Salmon, cooked", 206, 22, 0, 12, "1 fillet", 150, "fs"],
  ["Tuna, canned in water", 116, 26, 0, 0.8, "1 can, drained", 120, "fs"],
  ["White fish (cod), cooked", 105, 23, 0, 0.9, "1 fillet", 150, "fs"],
  ["Prawns / shrimp, cooked", 99, 24, 0.2, 0.3, "1 portion", 100, "sh"],
  ["Egg, boiled", 155, 12.6, 1.1, 10.6, "1 large", 50, "eg"],
  ["Egg, fried", 196, 13.6, 0.8, 14.8, "1 egg", 46, "eg"],
  ["Egg white", 52, 10.9, 0.7, 0.2, "1 white", 33, "eg"],
  ["Tofu, firm", 144, 17.3, 2.8, 8.7, "100 g", 100, "sy"],
  ["Tempeh", 192, 20.3, 7.6, 10.8, "100 g", 100, "sy"],
  ["Lentils, cooked", 116, 9, 20, 0.4, "1 cup", 198],
  ["Chickpeas, cooked", 164, 8.9, 27.4, 2.6, "1 cup", 164],
  ["Black beans, cooked", 132, 8.9, 23.7, 0.5, "1 cup", 172],
  ["Edamame", 121, 11.9, 8.9, 5.2, "1 cup", 155, "sy"],
  ["Whey protein powder", 400, 80, 8, 6, "1 scoop", 30, "dy"],
  // Dairy and alternatives
  ["Milk, whole", 61, 3.2, 4.8, 3.3, "1 cup", 244, "dy"],
  ["Milk, skim", 34, 3.4, 5, 0.1, "1 cup", 245, "dy"],
  ["Soy milk, unsweetened", 33, 2.9, 1.7, 1.6, "1 cup", 243, "sy"],
  ["Oat milk", 47, 1, 6.7, 1.5, "1 cup", 240, "gl"],
  ["Almond milk, unsweetened", 15, 0.6, 0.6, 1.2, "1 cup", 240, "tn"],
  ["Greek yogurt, plain, nonfat", 59, 10.2, 3.6, 0.4, "1 pot", 170, "dy"],
  ["Yogurt, plain, whole milk", 61, 3.5, 4.7, 3.3, "1 pot", 150, "dy"],
  ["Cheddar cheese", 403, 25, 1.3, 33, "1 slice", 28, "dy"],
  ["Mozzarella", 280, 28, 3.1, 17, "1 portion", 30, "dy"],
  ["Cottage cheese", 98, 11, 3.4, 4.3, "½ cup", 113, "dy"],
  ["Butter", 717, 0.9, 0.1, 81, "1 tbsp", 14, "dy"],
  ["Ice cream, vanilla", 207, 3.5, 24, 11, "1 scoop", 70, "dy"],
  // Fruit
  ["Banana", 89, 1.1, 22.8, 0.3, "1 medium", 118],
  ["Apple", 52, 0.3, 13.8, 0.2, "1 medium", 182],
  ["Orange", 47, 0.9, 11.8, 0.1, "1 medium", 131],
  ["Grapes", 69, 0.7, 18.1, 0.2, "1 cup", 150],
  ["Strawberries", 32, 0.7, 7.7, 0.3, "1 cup", 150],
  ["Blueberries", 57, 0.7, 14.5, 0.3, "1 cup", 148],
  ["Mango", 60, 0.8, 15, 0.4, "1 cup", 165],
  ["Pineapple", 50, 0.5, 13.1, 0.1, "1 cup", 165],
  ["Watermelon", 30, 0.6, 7.6, 0.2, "1 cup", 152],
  ["Papaya", 43, 0.5, 10.8, 0.3, "1 cup", 140],
  ["Pear", 57, 0.4, 15.2, 0.1, "1 medium", 178],
  ["Kiwi", 61, 1.1, 14.7, 0.5, "1 fruit", 69],
  ["Durian", 147, 1.5, 27.1, 5.3, "100 g", 100],
  ["Lychee", 66, 0.8, 16.5, 0.4, "5 fruits", 50],
  ["Avocado", 160, 2, 8.5, 14.7, "½ avocado", 100],
  ["Dates, dried", 282, 2.5, 75, 0.4, "1 date", 24],
  ["Raisins", 299, 3.1, 79, 0.5, "1 small box", 43],
  // Vegetables
  ["Broccoli, cooked", 35, 2.4, 7.2, 0.4, "1 cup", 156],
  ["Spinach, cooked", 23, 3, 3.8, 0.3, "1 cup", 180],
  ["Bok choy / pak choi, cooked", 12, 1.6, 1.8, 0.2, "1 cup", 170],
  ["Cabbage, cooked", 23, 1.3, 5.5, 0.1, "1 cup", 150],
  ["Carrot, raw", 41, 0.9, 9.6, 0.2, "1 medium", 61],
  ["Tomato", 18, 0.9, 3.9, 0.2, "1 medium", 123],
  ["Cucumber", 15, 0.7, 3.6, 0.1, "½ cucumber", 150],
  ["Mixed salad leaves", 15, 1.4, 2.9, 0.2, "1 bowl", 80],
  ["Mushrooms, cooked", 28, 2.2, 5.3, 0.5, "1 cup", 156],
  ["Sweetcorn, boiled", 96, 3.4, 21, 1.5, "1 cob", 100],
  ["Green peas", 81, 5.4, 14.5, 0.4, "½ cup", 80],
  ["Onion", 40, 1.1, 9.3, 0.1, "1 medium", 110],
  ["Bell pepper", 31, 1, 6, 0.3, "1 medium", 120],
  ["Aubergine / eggplant, cooked", 35, 0.8, 8.7, 0.2, "1 cup", 99],
  ["Kimchi", 15, 1.1, 2.4, 0.5, "1 serving", 100, "fs sh"],
  // Fats, nuts, seeds
  ["Olive oil", 884, 0, 0, 100, "1 tbsp", 13.5],
  ["Peanut butter", 588, 25, 20, 50, "1 tbsp", 16, "pn"],
  ["Almonds", 579, 21.2, 21.6, 49.9, "1 handful", 28, "tn"],
  ["Peanuts", 567, 25.8, 16.1, 49.2, "1 handful", 28, "pn"],
  ["Cashews", 553, 18.2, 30.2, 43.9, "1 handful", 28, "tn"],
  ["Walnuts", 654, 15.2, 13.7, 65.2, "1 handful", 28, "tn"],
  ["Chia seeds", 486, 16.5, 42.1, 30.7, "1 tbsp", 12],
  // Snacks and sweet things
  ["Dark chocolate (70-85%)", 598, 7.8, 46, 43, "2 squares", 20, "dy"],
  ["Milk chocolate", 535, 7.7, 59.4, 29.7, "4 squares", 25, "dy"],
  ["Potato crisps / chips", 536, 7, 53, 35, "1 small bag", 28],
  ["Chocolate chip cookie", 488, 5.7, 64, 24, "1 cookie", 30, "gl dy eg"],
  ["Popcorn, air-popped", 387, 12.9, 77.8, 4.5, "1 cup", 8],
  ["Honey", 304, 0.3, 82.4, 0, "1 tbsp", 21],
  ["Sugar", 387, 0, 100, 0, "1 tsp", 4],
  ["Jam", 250, 0.4, 65, 0.1, "1 tbsp", 20],
  // Drinks (per 100 ml)
  ["Cola", 42, 0, 10.6, 0, "1 can", 330],
  ["Orange juice", 45, 0.7, 10.4, 0.2, "1 glass", 250],
  ["Beer", 43, 0.5, 3.6, 0, "1 can", 330, "gl al"],
  ["Red wine", 85, 0.1, 2.6, 0, "1 glass", 150, "al"],
  ["Latte (whole milk)", 50, 3, 4.5, 2.6, "1 cup", 240, "dy"],
  ["Black coffee", 1, 0.1, 0, 0, "1 cup", 240],
  ["Milk tea with sugar (teh)", 55, 1.5, 9, 1.5, "1 cup", 250, "dy D"],
  ["Bubble tea with pearls", 78, 1, 14, 2.3, "1 cup", 500, "dy D"],
  ["Soy sauce", 53, 8.1, 4.9, 0.6, "1 tbsp", 16, "sy gl"],
  // Dishes (values vary a lot by recipe)
  ["Pizza, cheese", 266, 11, 33, 10, "1 slice", 107, "gl dy D"],
  ["Cheeseburger", 263, 13, 24, 12, "1 burger", 200, "gl dy bf mt D"],
  ["Chicken rice (Hainanese)", 175, 8, 25, 5, "1 plate", 350, "mt D"],
  ["Sushi (nigiri or maki)", 145, 6, 26, 1.5, "6 pieces", 180, "fs D"],
  ["Ramen with broth", 110, 5, 14, 3.5, "1 bowl", 500, "gl eg pk mt D"],
  ["Pad thai", 160, 6, 22, 6, "1 plate", 300, "pn sh eg D"],
  ["Dal (lentil curry)", 100, 6, 14, 3, "1 bowl", 250, "D"],
  ["Chicken curry", 140, 11, 5, 8, "1 bowl", 250, "mt D"],
  ["Steamed dumplings", 200, 9, 25, 7, "4 pieces", 120, "gl sy pk D"],
  ["Caesar salad with chicken", 150, 11, 6, 9, "1 bowl", 300, "dy fs gl eg D"],
  ["Shawarma / kebab wrap", 215, 14, 22, 8, "1 wrap", 250, "gl mt D"],
  ["Burrito", 190, 8, 24, 7, "1 burrito", 300, "gl dy mt D"],
];

export const COMMON_FOODS: CommonFood[] = ROWS.map(([name, kcal, protein, carbs, fat, servingLabel, servingGrams, tags = ""], i) => {
  const codes = tags.split(" ").filter(Boolean);
  return {
    id: `cf${i}`,
    name,
    per100: { kcal, protein, carbs, fat },
    servingLabel,
    servingGrams,
    contains: codes.map((c) => TAG[c]).filter((t): t is FoodTag => !!t),
    dish: codes.includes("D"),
  };
});

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const SPELLING: [RegExp, string][] = [[/\bshrimps?\b/g, "prawn"], [/\bprawns\b/g, "prawn"], [/\bchips\b/g, "fries"], [/\bcurd\b/g, "yogurt"], [/\byoghurt\b/g, "yogurt"], [/\bcoriander\b/g, "cilantro"], [/\baubergine\b/g, "eggplant"]];
const words = (s: string) => {
  let t = norm(s);
  for (const [re, to] of SPELLING) t = t.replace(re, to);
  return t.split(" ").filter(Boolean);
};

/** Foods whose name contains every word typed (prefix matches count), best matches first. */
export function searchCommonFoods(query: string, limit = 8): CommonFood[] {
  const q = words(query);
  if (q.length === 0) return [];
  const scored: { f: CommonFood; score: number }[] = [];
  for (const f of COMMON_FOODS) {
    const w = words(f.name);
    let score = 0;
    let ok = true;
    for (const t of q) {
      const hit = w.findIndex((x) => x === t);
      const pre = hit >= 0 ? hit : w.findIndex((x) => x.startsWith(t));
      if (pre < 0) {
        ok = false;
        break;
      }
      score += (hit >= 0 ? 10 : 6) - Math.min(pre, 4);
    }
    if (ok) scored.push({ f, score: score - w.length * 0.2 });
  }
  return scored.sort((a, b) => b.score - a.score || a.f.name.localeCompare(b.f.name)).slice(0, limit).map((s) => s.f);
}
