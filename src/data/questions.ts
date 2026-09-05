import type { AnswerOption, Question } from "@/lib/quiz/types";
export const QUIZ_VERSION="2026.2";
export const STANDARD_OPTIONS = [
 {value:"like_it",label:"I have done it and love it",score:100},{value:"tried_neutral",label:"I have tried it and feel neutral",score:50},{value:"tried_disliked",label:"I have tried it and did not like it",score:10},{value:"want_to_try",label:"I have not done it, but want to try",score:75},{value:"maybe_conditions",label:"Maybe, under the right conditions",score:45},{value:"not_interested",label:"I am not interested",score:0},{value:"hard_limit",label:"This is a hard limit",score:0,boundary:true}
] as const satisfies readonly AnswerOption[];
const groups = {
 everyday:["preferred frequency","initiating intimacy","a partner initiating intimacy","spontaneous intimacy","planned intimacy","morning intimacy","nighttime intimacy","quick encounters","long sessions","lights on","lights off","music during intimacy","talking during intimacy","giving dirty talk","receiving dirty talk","giving praise","receiving praise","sexting with a trusted partner","consensually sending intimate images","consensually receiving intimate images","lingerie or special clothing","shower intimacy","hotel intimacy","car intimacy in a lawful private setting","an outdoor fantasy in a lawful genuinely private setting"],
 physical:["being on top","a partner being on top","face-to-face positions","from-behind positions","side-by-side or spooning positions","standing positions","sitting or chair positions","positions against a wall","a slow pace","a fast pace","gentle intensity","rougher consensual intensity","deep penetration where anatomically relevant","shallow penetration","changing positions frequently","staying in one preferred position","long eye contact","being physically guided","physically guiding a partner"],
 oral:["giving oral sex","receiving oral sex","mutual oral sex or 69","giving face-sitting where anatomically relevant","receiving face-sitting where anatomically relevant","giving deep-throat activity where anatomically relevant","receiving deep-throat activity where anatomically relevant","more intense consensual oral activity","swallowing where relevant","a partner finishing in the mouth where relevant","eye contact during oral sex","oral-focused sessions"],
 anal:["external anal touching","receiving anal fingering","giving anal fingering","receiving anal penetration where anatomically relevant","giving anal penetration where anatomically relevant","receiving rimming","giving rimming","anal plugs","other anal toys","giving strap-on anal play","receiving strap-on anal play","double penetration as a consensual adult fantasy","participating in consensual adult double penetration"],
 power:["taking a dominant role","taking a submissive role","switching power roles","giving commands","following commands","hand restraints","handcuffs","rope bondage","being restrained","restraining a partner","blindfolds","giving spanking","receiving spanking","consensual hair pulling","scratching","biting","tickling","teasing","orgasm control","consensual orgasm denial","praise-oriented dynamics","a fictional consensual degradation fantasy","using safe words","giving aftercare","receiving aftercare"],
 toys:["vibrators","dildos","anal plugs","couples toys","remote-controlled toys","giving strap-on play","receiving strap-on play","using toys on a partner","a partner using toys on you","adult costumes","fictional consensual adult role-play","fantasy characters who are clearly adults","consensual power-role scenarios","watching a partner use a toy","being watched by a partner while using a toy"],
 watching:["watching adult pornography alone","watching adult pornography with a partner","watching a partner masturbate","being watched by a partner while masturbating","watching a partner with another consenting adult","a partner watching you with another consenting adult","being watched by another informed consenting adult","watching another consenting adult couple","an exhibitionist fantasy in a lawful consensual private setting","a voyeuristic fantasy involving only informed consenting adults","making a private home video with everyone’s explicit consent","being recorded by a partner with explicit consent","recording a partner with explicit consent","watching a private recording together","taking private intimate photos with explicit consent"],
 groups:["a threesome with two women and one man","a threesome with two men and one woman","participating in a threesome","watching a threesome involving consenting adults","consensual adult group sex","same-room sex with another adult couple","consensual couple swapping","swinging","an agreed open relationship","a one-time consensual non-monogamous experience","being the focus of several consenting adult partners","participating in a consensual adult gangbang","a consensual adult gangbang fantasy","consensual adult double penetration","watching a partner with another consenting adult","a partner watching you with another consenting adult","a cuckold-style consensual fantasy","a hotwife-style consensual fantasy","a cuckquean-style consensual fantasy","sharing fantasies without intending to act on them"],
 fluids:["giving a consensual golden shower","receiving a consensual golden shower","a urination fantasy without acting on it","giving consensual spitting play","receiving consensual spitting play","consensual fluid play","messier consensual sexual play"],
 communication:["discussing desires before acting","asking before introducing a new activity","using a safe word","respecting stop immediately","checking in during intense activity","discussing STI testing","discussing barrier protection","agreeing explicitly about recording","never sharing recordings without permission","discussing non-monogamy before acting","aftercare","emotional reassurance","protecting each other’s privacy","ensuring everyone is sober enough to consent","feeling comfortable saying no","feeling comfortable hearing no","respecting a hard limit without persuasion"]
} as const;
const labels:Record<string,string>={everyday:"Everyday Intimacy",physical:"Positions, Pace & Style",oral:"Oral Preferences",anal:"Anal Interests",power:"Power, Control & Sensory",toys:"Toys & Role-play",watching:"Watching & Recording",groups:"Groups & Consensual Non-monogamy",fluids:"Fluid & Intense Interests",communication:"Communication & Boundaries"};
let order=0;

/** Relative intensity per category, used for pacing and future filtering. */
const intensityByCategory: Record<string, 1 | 2 | 3 | 4 | 5> = {
  communication: 1, everyday: 1, physical: 2, oral: 3, toys: 3,
  watching: 3, anal: 4, power: 4, groups: 4, fluids: 5,
};

/**
 * Derives the participant role from the topic wording so that giving,
 * receiving, watching, and being-watched variants stay distinguishable in the
 * data model rather than all collapsing to "self".
 */
function roleFor(topic: string): Question["role"] {
  if (/^being watched|watching you|^being recorded|^being the focus/.test(topic)) return "being_watched";
  if (/^watching|^a partner watching/.test(topic)) return "watching";
  if (/^receiving|^being restrained|^being physically guided|^a partner using toys|^a partner finishing|^a partner initiating|^a partner being on top/.test(topic)) {
    return "receiving";
  }
  if (/^giving|^recording a partner|^restraining a partner|^physically guiding|^using toys on a partner/.test(topic)) return "giving";
  if (/^mutual|^discussing|^agreeing|^checking in|^sharing fantasies|^same-room|^consensual couple|^swinging|^an agreed open|^face-to-face/.test(topic)) {
    return "mutual";
  }
  return "self";
}

export const questions: Question[] = Object.entries(groups).flatMap(([categoryId, topics]) =>
  topics.map((topic, index) => ({
    id: `${categoryId}_${String(index + 1).padStart(2, "0")}`,
    version: QUIZ_VERSION,
    categoryId,
    categoryLabel: labels[categoryId],
    shortLabel: topic,
    prompt: `How do you feel about ${topic}?`,
    helpText:
      categoryId === "watching"
        ? "DesireDNA never accepts or stores intimate media."
        : categoryId === "fluids"
          ? "This category is entirely optional — skipping it does not affect anything else."
          : undefined,
    responseType: "single_choice" as const,
    role: roleFor(topic),
    intensity: intensityByCategory[categoryId] ?? 2,
    answerOptions: STANDARD_OPTIONS,
    scoringEnabled: true,
    comparisonEnabled: true,
    sensitiveTags: categoryId === "fluids" ? ["optional_intense"] : [],
    sortOrder: order++,
  })),
);
export const pornCategories=["Amateur adults","Professional or cinematic","Romantic","Couples","Solo women","Solo men","Lesbian adults","Gay male adults","Bisexual adults","Trans adults","Oral-focused","Anal-focused","Toys","Consensual rough content","BDSM","Dominance","Submission","Adult role-play","Threesomes with two women and one man","Threesomes with two men and one woman","Group sex","Consensual gangbang","Mature adults","Adult animation with clearly adult characters only","Voyeur or exhibition fantasy involving informed adults"];
questions.push({id:"porn_categories",version:QUIZ_VERSION,categoryId:"porn",categoryLabel:"Adult Media Preferences",shortLabel:"adult media categories",prompt:"Which adult-only media categories do you enjoy?",helpText:"Optional. Select any that apply. Only mutual selections can appear in a comparison.",responseType:"multi_select",role:"self",intensity:1,answerOptions:pornCategories.map(value=>({value,label:value,score:0})),scoringEnabled:false,comparisonEnabled:true,sensitiveTags:["adult_media"],sortOrder:order++});
export const raceSensitiveQuestion:Question={...questions.at(-1)!,id:"porn_racial_ethnic",shortLabel:"multi-ethnic adult media",prompt:"Do you select interracial or multi-ethnic adult content?",responseType:"single_choice",answerOptions:STANDARD_OPTIONS,scoringEnabled:false,comparisonEnabled:false,sensitiveTags:["racial_ethnic_data"],sortOrder:order++};
export function getQuestions() {
  const enabled =
    process.env.NEXT_PUBLIC_ENABLE_RACE_SENSITIVE_ITEMS === "true"
      ? [...questions, raceSensitiveQuestion]
      : questions;

  // Explicitly impossible in a production build. This keeps Playwright runs
  // short without changing the production question bank.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_E2E_SHORT_QUIZ === "true"
  ) {
    const firstByCategory = new Map<string, Question>();
    for (const question of enabled) {
      if (!firstByCategory.has(question.categoryId)) {
        firstByCategory.set(question.categoryId, question);
      }
    }
    return [...firstByCategory.values()];
  }

  return enabled;
}
