/**
 * Built-in deterministic vocabulary. Terms are normalized before matching, so
 * common spacing, punctuation, leetspeak and zero-width evasions are covered.
 * Guild-specific additions live in Firestore and never require a redeploy.
 */
export const PROFANITY_TERMS = [
  'arsehole', 'asshat', 'asshole', 'bastard', 'bitch', 'bollocks', 'bullshit', 'cocksucker',
  'cunt', 'dickhead', 'dipshit', 'douche', 'douchebag', 'dumbass', 'fuck', 'fucker',
  'fucking', 'jackass', 'motherfucker', 'piss off', 'prick', 'shit', 'shithead', 'slut',
  'son of a bitch', 'twat', 'wanker', 'whore',
];

export const HATE_TERMS = [
  'chink', 'coon', 'faggot', 'gook', 'kike', 'nigger', 'nigga', 'raghead', 'retard',
  'spic', 'tranny', 'wetback',
];

export const SEXUAL_TERMS = [
  'child porn', 'cp link', 'csam', 'explicit minors', 'nudes', 'send nudes', 'onlyfans leak',
  'rape porn', 'revenge porn', 'underage nudes',
];

export const THREAT_PHRASES = [
  'bomb this', 'dox you', 'doxx you', 'find your address', 'i will kill', 'kill yourself',
  'kys', 'shoot you', 'swat you', 'your ip is',
];

export const SCAM_PHRASES = [
  'claim your nitro', 'free nitro', 'free robux', 'gift inventory', 'steam gift',
  'verify your account', 'wallet connect', 'wallet validation',
];

export const ALL_BUILT_IN_TERMS = [...PROFANITY_TERMS, ...HATE_TERMS, ...SEXUAL_TERMS];

export const DANGEROUS_EXTENSIONS = ['.exe', '.scr', '.bat', '.cmd', '.com', '.msi', '.ps1', '.jar', '.vbs', '.lnk'];
export const SUSPICIOUS_TLDS = ['.zip', '.mov', '.top', '.click', '.gq', '.tk', '.work', '.support'];
