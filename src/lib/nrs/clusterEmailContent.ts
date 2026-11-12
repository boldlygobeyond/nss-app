import type { ClusterKey } from "./clusters";

// Per-cluster email copy, verbatim from the approved spec. Every cluster
// shares the exact same sentence skeletons across all three NRS emails
// (invite/reminder/results) — only these fragments differ: the "the needs
// that help us feel ..." clause (with its own bolded words/phrases), the
// cluster's possessive form (one cluster, Energizing Connections, takes a
// bare apostrophe, not "'s"), its one-line sign-off, and the two "See the
// Signals" reflection questions (also with their own bolded phrases).
// Fragments are raw HTML (pre-escaped literal text, no user input) meant
// to be interpolated directly into each email's template literal.
export const NRS_CLUSTER_EMAIL_CONTENT: Record<
  ClusterKey,
  {
    opening: string;
    possessive: string;
    signoff: string;
    reflectionQuestions: [string, string];
  }
> = {
  Stability: {
    opening:
      "<strong>grounded</strong>, <strong>secure</strong>, and able to <strong>navigate our environment</strong> with confidence.",
    possessive: "Core Stability's",
    signoff: "Keep it stable!",
    reflectionQuestions: [
      "What was one moment this week when you felt particularly <strong>secure</strong> or <strong>supported</strong> at work?",
      "When did you find yourself wishing for more <strong>clarity</strong>, <strong>consistency</strong>, or <strong>control</strong> over your work?",
    ],
  },
  Agency: {
    opening:
      "<strong>empowered</strong>, <strong>challenged</strong>, and able to <strong>learn, grow, and shape our own direction</strong>.",
    possessive: "Agency & Growth's",
    signoff: "Grow boldly!",
    reflectionQuestions: [
      "When was a moment this week when you felt <strong>trusted to make a decision</strong> or <strong>try something new</strong> at work?",
      "When did you find yourself wishing you had more <strong>freedom to make a choice, learn something, or influence</strong> how work gets done?",
    ],
  },
  Belonging: {
    opening:
      "<strong>seen</strong>, <strong>accepted</strong>, and <strong>free to be ourselves</strong> while feeling connected to the people around us.",
    possessive: "Belonging & Identity's",
    signoff: "Keep being you!",
    reflectionQuestions: [
      "What was one moment this week when you felt <strong>genuinely included, understood</strong>, or <strong>free to be yourself</strong> at work?",
      "When did you find yourself feeling like you had to <strong>hold back part of who you are</strong> or <strong>work harder to fit in</strong>?",
    ],
  },
  Ecosystem: {
    opening:
      "<strong>emotionally safe</strong>, <strong>understood</strong>, and <strong>supported</strong>, with space to express ourselves openly and honestly.",
    possessive: "Emotional Ecosystem's",
    signoff: "Keep it real!",
    reflectionQuestions: [
      "What was one moment this week when you felt <strong>safe expressing how you really felt</strong> or <strong>knew someone had your back</strong> at work?",
      "When did you find yourself <strong>holding back a feeling, worrying about being judged</strong>, or <strong>wishing someone understood</strong> what you were going through?",
    ],
  },
  Connections: {
    opening:
      "<strong>connected</strong>, <strong>inspired</strong>, and <strong>energized</strong> through meaningful interactions and shared experiences with others.",
    possessive: "Energizing Connections'",
    signoff: "Keep the sparks flying!",
    reflectionQuestions: [
      "What was one moment this week when an interaction with a teammate left you feeling <strong>energized, inspired, or more connected</strong>?",
      "When did you find yourself wishing for more opportunities to <strong>connect, collaborate, or share an enjoyable experience</strong> with others at work?",
    ],
  },
  Purpose: {
    opening:
      "<strong>connected to something meaningful</strong>, <strong>guided by our values</strong>, and <strong>aligned with the work we do</strong>.",
    possessive: "Purpose & Alignment's",
    signoff: "Follow your North Star!",
    reflectionQuestions: [
      "What was one moment this week when your work felt especially <strong>meaningful</strong> or <strong>connected to something you care about</strong>?",
      "When did you find yourself <strong>questioning the purpose</strong> of something you were doing or <strong>wishing your work felt more aligned</strong> with your values?",
    ],
  },
  Recognition: {
    opening: "<strong>appreciated</strong>, <strong>respected</strong>, and <strong>valued</strong> for who we are and what we contribute.",
    possessive: "Recognition & Value's",
    signoff: "Shine on!",
    reflectionQuestions: [
      "What was one moment this week when you felt <strong>genuinely appreciated, respected, or recognized</strong> for something you contributed at work?",
      "When did you find yourself wishing your <strong>efforts were more visible, your contributions were acknowledged, or your perspective was valued</strong>?",
    ],
  },
};
