// Richer seed bank — used as fallback when no Anthropic key, and as a candidate
// list passed to Claude so it can pick 5 fresh ones each day without repeating.
// Each entry teaches the root with meaning, etymology, mnemonic, example defs, usage tip.
window.ROOTS = [
  {
    root: "chron", origin: "Greek", meaning: "time",
    meaningFull: "Relating to time, duration, or the ordering of events. Any word carrying this root points to when, how long, or in what sequence something happens.",
    etymology: "From Greek 'khronos' (χρόνος), meaning time or age — Kronos was the personified figure of time in Greek mythology.",
    mnemonic: "Picture an antique brass clock face with exposed gears, ticking away the moments of history.",
    examples: [
      { word: "chronic", meaning: "lasting for a long time — usually a condition, illness, or problem." },
      { word: "synchronize", meaning: "to make two or more things happen at exactly the same time." },
      { word: "anachronism", meaning: "something placed in the wrong time period — a knight with a smartphone, for example." }
    ],
    usageNote: "If you spot 'chron' in a word on the test, think TIME — duration, sequence, or historical order."
  },
  {
    root: "bene", origin: "Latin", meaning: "good, well",
    meaningFull: "Indicates something good, kind, favorable, or beneficial. Words with 'bene' carry a positive moral or practical value.",
    etymology: "From Latin 'bene', an adverb meaning 'well' — the opposite of 'male' (badly). Entered English through medieval Church Latin, especially in words involving blessings.",
    mnemonic: "Imagine a kind king stepping from his throne to hand bread to hungry children — every good act is a benefit.",
    examples: [
      { word: "benevolent", meaning: "well-meaning and kind; wanting to do good for others." },
      { word: "benefit", meaning: "an advantage or good thing gained from something." },
      { word: "benign", meaning: "gentle, harmless; in medicine, a tumor that is not cancerous." }
    ],
    usageNote: "Any word with 'bene' usually signals goodness, kindness, or something favorable."
  },
  {
    root: "mal", origin: "Latin", meaning: "bad, evil",
    meaningFull: "Signals something bad, harmful, or faulty. The direct opposite of 'bene'.",
    etymology: "From Latin 'malus' (bad) and 'male' (badly). Common in both medical terms (malaria = 'bad air') and moral judgments (malice, malevolent).",
    mnemonic: "See a twisted dagger resting on black velvet — every malevolent plan begins with one small, bad seed.",
    examples: [
      { word: "malevolent", meaning: "wishing evil or harm on others; actively hostile." },
      { word: "malice", meaning: "the intention to do harm; ill will." },
      { word: "malfunction", meaning: "a failure to work properly — the machine performs badly." }
    ],
    usageNote: "If you see 'mal' in a word, expect something bad, broken, or harmful."
  },
  {
    root: "dict", origin: "Latin", meaning: "speak, say",
    meaningFull: "Points to speech, declaration, or authoritative saying. Words with 'dict' involve voicing, commanding, or predicting.",
    etymology: "From Latin 'dicere' (to say, to speak), past participle 'dictus'. The root carries the weight of formal utterance — not just chatter, but saying that matters.",
    mnemonic: "Picture a Roman senator standing in the forum, finger raised, dictating law to scribes who furiously write every word.",
    examples: [
      { word: "dictate", meaning: "to say something aloud for another to write down, or to command authoritatively." },
      { word: "contradict", meaning: "to say the opposite; to assert that a statement is false." },
      { word: "edict", meaning: "an official order issued by a person in authority." }
    ],
    usageNote: "Any word with 'dict' is about speech, statement, or command — someone is saying something that carries weight."
  },
  {
    root: "ject", origin: "Latin", meaning: "throw",
    meaningFull: "Relates to throwing, casting, or forcing something in a direction — physically or metaphorically.",
    etymology: "From Latin 'jacere' (to throw), past participle 'jectus'. Ancient Romans used it for both hurling objects and 'throwing out' ideas or arguments.",
    mnemonic: "Imagine a medieval catapult hurling a stone in a high arc across a castle wall — every project is an idea thrown forward.",
    examples: [
      { word: "reject", meaning: "to throw back; to refuse to accept or consider something." },
      { word: "project", meaning: "to throw forward — either physically (a projectile) or as a plan thrown into the future." },
      { word: "eject", meaning: "to throw out forcefully — a pilot ejects from a cockpit in emergency." }
    ],
    usageNote: "If 'ject' appears, something is being thrown — in, out, forward, or back."
  },
  {
    root: "scrib", origin: "Latin", meaning: "write",
    meaningFull: "Concerns writing, inscribing, or recording in a formal way. Words with 'scrib' or 'script' evoke scrolls, records, and the written word.",
    etymology: "From Latin 'scribere' (to write). Ancient scribes used styluses on wax tablets and quills on parchment — the root was everywhere in Roman legal and religious life.",
    mnemonic: "See a robed scribe, quill in hand, inscribing sacred scripture on parchment by flickering candlelight.",
    examples: [
      { word: "inscribe", meaning: "to write or carve letters onto a surface, often with ceremony or permanence." },
      { word: "scripture", meaning: "sacred written text, especially religious writings." },
      { word: "conscript", meaning: "to force someone to join the military — literally 'written in' to the rolls." }
    ],
    usageNote: "'Scrib' or 'script' always points to writing — recording, inscribing, or formally noting something down."
  },
  {
    root: "spect", origin: "Latin", meaning: "look, see",
    meaningFull: "Involves seeing, watching, or examining. Words with 'spect' are about the eye — whether looking outward (inspect) or reflecting inward (introspective).",
    etymology: "From Latin 'specere' / 'spectare' (to look at, to observe). The Romans used it for both casual viewing and formal inspection.",
    mnemonic: "Picture a general atop a hill, hand to brow, inspecting the terrain before battle — every prospect carefully surveyed.",
    examples: [
      { word: "inspect", meaning: "to look at something carefully in order to assess its condition." },
      { word: "spectator", meaning: "a person who watches an event, typically a sport or show." },
      { word: "prospect", meaning: "a view ahead; also, the possibility of a future event." }
    ],
    usageNote: "Any 'spect' word involves looking — examining, watching, or anticipating what can be seen."
  },
  {
    root: "port", origin: "Latin", meaning: "carry",
    meaningFull: "Relates to carrying, bearing, or transporting. Both physical carrying (cargo) and abstract bearing (deportment, bearing oneself).",
    etymology: "From Latin 'portare' (to carry). Also the root of 'porta' (gate) — the place through which things are carried.",
    mnemonic: "Imagine a line of porters shouldering trunks up a ship's gangway — every import and export passes through their hands.",
    examples: [
      { word: "transport", meaning: "to carry from one place to another." },
      { word: "portable", meaning: "able to be carried easily." },
      { word: "deport", meaning: "to officially carry a person out of a country." }
    ],
    usageNote: "'Port' tells you something is being carried or moved — goods, people, or even a person's bearing."
  },
  {
    root: "tele", origin: "Greek", meaning: "far, distant",
    meaningFull: "Indicates distance or remoteness. Modern technology borrows this root heavily because almost every communication device works across distance.",
    etymology: "From Greek 'tēle' (τῆλε), meaning 'far off' or 'at a distance'. Coined into modern scientific English in the 19th century for inventions that shrink distance.",
    mnemonic: "Picture an astronomer at a mountaintop telescope, peering across impossible distance to distant stars.",
    examples: [
      { word: "telephone", meaning: "a device for talking to someone far away." },
      { word: "telegraph", meaning: "a 19th-century system for sending messages over long distances via electrical signals." },
      { word: "television", meaning: "a device that shows images transmitted from far away." }
    ],
    usageNote: "'Tele' almost always signals distance — something happening, sensed, or transmitted across space."
  },
  {
    root: "aqua", origin: "Latin", meaning: "water",
    meaningFull: "Relates to water in all its forms — drinking, flowing, filling pools, or running through pipes.",
    etymology: "From Latin 'aqua' (water). One of the oldest and most stable roots in European languages; Romans named their aqueducts after it.",
    mnemonic: "Three rolling ocean waves crashing toward shore — the endless pulse of aquatic life.",
    examples: [
      { word: "aquarium", meaning: "a glass tank holding water and fish for display." },
      { word: "aquatic", meaning: "living or happening in water." },
      { word: "aqueduct", meaning: "a channel or bridge built to carry water over long distances." }
    ],
    usageNote: "Any 'aqua' word involves water — drinking it, living in it, or moving it somewhere."
  }
];
