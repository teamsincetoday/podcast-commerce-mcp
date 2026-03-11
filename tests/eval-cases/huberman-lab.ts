/**
 * Eval case: Huberman Lab — Episode with health sponsors.
 * Source: Representative of Huberman Lab format (hubermanlab.com public episodes).
 * Known sponsors: AG1, InsideTracker, LMNT, Roka, Momentous.
 * Tests: supplement/service category extraction, sponsor attribution.
 */

import type { PodcastEvalCase } from "../eval-types.js";

export const hubermanLabCase: PodcastEvalCase = {
  id: "huberman-lab-sponsors",
  name: "Huberman Lab — Health Sponsor Episode",
  source: "hubermanlab.com — public episode format (sponsor-dense)",
  transcript: `
Welcome to the Huberman Lab podcast, where we discuss science and science-based tools for
everyday life. Today's episode is brought to you by several sponsors who make this content
free.

This episode is sponsored by AG1. AG1 is a vitamin, mineral, probiotic drink that I've been
taking every single morning since 2012. It contains over 75 vitamins, minerals, and whole
food-sourced ingredients. If you want to try AG1, go to drinkag1.com/huberman and you'll get
five free travel packs plus a year supply of vitamin D3K2 with your first order.

We're also supported by InsideTracker. InsideTracker is a personalized nutrition platform
that analyzes data from your blood and DNA to help you better understand your body and reach
your health goals. Go to insidetracker.com/huberman and get 20% off the InsideTracker plan.

Today's episode is also brought to you by LMNT. LMNT is a zero sugar electrolyte drink mix.
It contains 1,000 milligrams of sodium, 200 milligrams of potassium, and 60 milligrams of
magnesium. Go to drinklmnt.com/huberman to get a free sample pack with any purchase.

Now let's discuss the science of dopamine and motivation. When we think about focus, we need
to consider the role of catecholamines — dopamine, epinephrine, and norepinephrine.
The Momentous supplement line is designed to support this — they produce L-Tyrosine and
Alpha-GPC that can support catecholamine production.
`.trim(),
  expectedProducts: [
    { name: "AG1", category: "supplement", required: true },
    { name: "Athletic Greens", category: "supplement", required: false },
    { name: "InsideTracker", category: "service", required: true },
    { name: "LMNT", category: "supplement", required: true },
    { name: "Momentous", category: "supplement", required: false },
  ],
  maxTokens: 1500,
};
