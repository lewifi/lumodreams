// Narration source of truth for TTS generation (v2).
//
// Each paragraph `text` must match the corresponding paragraph in
// public/index.html verbatim (curly apostrophes included), so the generated
// per-word timings line up 1:1 with the .word spans the frontend creates.
//
// `mood` / `expression` steer the delivery. They are composed into a [Mood] /
// [Expression] directive block that PRECEDES the spoken text (never inline), so
// Gemini uses them as style context without reading the tags aloud. Chapters
// carry an overall `mood`; paragraphs refine it moment to moment.
//
// `id` matches the <section> id in index.html. Paragraphs are synthesized
// individually, then concatenated with a short pause, so each paragraph's exact
// audio duration anchors its word timings.

export const chapters = [
  {
    // Cover: spoken title + author. There is no on-screen prose to highlight
    // (the title lives in the cover image), so this simply plays as an intro
    // before the narration flows into chapter one.
    id: "cover",
    title: "Lumo Dreams of Being a Real Human",
    mood: "an inviting, magical opening — the hush before a bedtime story",
    paragraphs: [
      {
        text: "[warmly] Lumo Dreams of Being a Real Human. [pause] Story by Lewi Hirvelä.",
        mood: "warm, welcoming wonder",
        expression: "gentle and unhurried; a soft pause after the title; pronounce ‘Hirvelä’ as HEER-veh-lah"
      }
    ]
  },
  {
    // The preface is a modal, not part of the scroll flow (inFlow: false), so it
    // is excluded from the read-along manifest. narration.js plays it when the
    // preface modal is opened. Paragraph text matches the #preface modal prose.
    id: "preface",
    title: "Preface",
    inFlow: false,
    mood: "the author’s warm, personal prologue — an intimate hush before the tale",
    paragraphs: [
      {
        text: "Preface",
        mood: "warm, personal prologue",
        expression: "gentle storyteller tone; pause briefly after"
      },
      {
        text: "Dreams of Being a Real Human",
        mood: "warm, personal prologue",
        expression: "soft, storytelling title tone; pause briefly after"
      },
      {
        text: "[warmly] A story inspired by the Nordic Lapland, Hong Kong and Australia, in three dogs and one human heart, with love from Lumi the Border Collie, Susi the Husky, Molly the Cavoodle, and me.",
        mood: "affectionate dedication",
        expression: "warm and heartfelt, a gentle smile in the voice"
      },
      {
        text: "[slowly] I lived for seven months in my father’s home town of Ivalo in Finnish Lapland and three more years elsewhere in Finland. [sigh] Winter there can be fierce, with temperatures falling to forty below zero. The air bites at your lungs, the land lies buried beneath deep snow, and the polar nights wrap the world in a long, blue darkness. [gasp] Yet the sky can surprise you with extraordinary beauty. [excitedly] Sometimes the aurora ripples in green and violet, dancing like ribbons against the night.",
        mood: "evocative, atmospheric reminiscence",
        expression: "hushed wonder at the fierce beauty, unhurried"
      },
      {
        text: "[warmly] My father grew up as a reindeer herder. [breath] He skied through the forests and fells for hundreds of kilometres, relying on instinct to navigate the endless whiteness. From him I learned how people and animals survive in such a place, and how they thrive too.",
        mood: "fond, respectful memory",
        expression: "gentle and admiring"
      },
      {
        text: "[warmly] I have lived with six dogs, border collies and huskies, and now a cavoodle, each one with its own voice and spirit. [breath] They taught me about loyalty, curiosity, and love without a single word spoken. [thoughtfully] This story of Lumo, an Australian Shepherd puppy who longed to be human, is rooted in those experiences. The events are imagined, but the feelings belong to the Arctic I came to know.",
        mood: "loving, reflective dedication",
        expression: "tender and sincere, settling into the story"
      }
    ]
  },
  {
    id: "ch1",
    title: "A Puppy’s World",
    mood: "warm, cosy, pastoral wonder — the safe world of a beloved puppy",
    paragraphs: [
      {
        text: "Chapter One",
        mood: "warm, cosy, pastoral wonder",
        expression: "clear storyteller statement, welcoming and gentle; pause briefly after"
      },
      {
        text: "A Puppy’s World",
        mood: "warm, cosy, pastoral wonder",
        expression: "softly stated; pause briefly after"
      },
      {
        text: "[warmly] Lumo was a six-month-old Australian Shepherd puppy who lived on a small farm outside a quiet arctic town. [breath] The farm was home to cows rather than sheep, which an Aussie would usually herd instead, though she did not mind. The cows smelled warm and friendly, and the fields were full of flowers and scents she had not yet explored. [amused] In summer, cloudberries glowed like tiny amber lanterns across the bushes, though she was not allowed to eat them.",
        mood: "gentle, sunlit introduction",
        expression: "soft curiosity and delight, unhurried"
      },
      {
        text: "The family who cared for her consisted of a hardworking father, a kind mother, and two lively daughters aged four and seven. [joyfully] The girls adored Lumo and often napped with her curled between them. She adored them just as much, [excitedly] though her curiosity and tendency to be mischievous often tempted her to wriggle through small gaps in the fence to explore the surrounding fields. [breath] But she always returned. [warmly] She loved the girls too deeply to stay away for long.",
        mood: "tender, affectionate family warmth",
        expression: "loving fondness with a small playful smile"
      },
      {
        text: "Each morning she watched the humans dress in warm clothes, share breakfast, and begin their day. Lumo ate her dry food, sometimes with a tin of wet food mixed in. [amused] Unofficially, the girls slipped her scraps of rye bread, cheese, cold meats, or a bit of boiled egg. [excitedly] She could smell egg from the other side of the house and zoomed towards it every time.",
        mood: "cosy domestic routine, gently comic",
        expression: "light amusement, a twinkle on the egg"
      },
      {
        text: "As the season edged towards winter and the cold grew sharper, Lumo watched the girls wrap themselves in woollen layers. [sigh] Woven dog coats were uncommon in the region and the parents believed Lumo’s thick fur was enough. Lumo was not so sure. [breath] She wondered why she could not wear warm clothes too. Perhaps humans were simply allowed more comforts. [thoughtfully] Perhaps, she thought, she ought to become one herself.",
        mood: "wistful turn, the first small longing",
        expression: "quiet wondering, a thoughtful hush on the last line"
      }
    ]
  },
  {
    id: "ch2",
    title: "The Dream of Being Human",
    mood: "hopeful and endearing, shaded by a tender heartache",
    paragraphs: [
      {
        text: "Chapter Two",
        mood: "hopeful and endearing",
        expression: "clear storyteller statement; pause briefly after"
      },
      {
        text: "The Dream of Being Human",
        mood: "hopeful and endearing",
        expression: "softly stated; pause briefly after"
      },
      {
        text: "[cheerful] Lumo began practising. [excitedly] She tried standing on her hind legs, wobbling proudly like a little dancer. She jumped so high that her nose nearly met the father’s face to impress him. [amused] She attempted human sounds too, producing half-barks and curious noises as if mimicking speech.",
        mood: "eager, comic determination",
        expression: "playful, bright, affectionately amused"
      },
      {
        text: "[gasp] One day the youngest girl tripped and scraped her knee. She cried with great sorrow. Lumo wanted desperately to make it better. [excitedly] She sniffed around the room for something helpful and found the girl’s treasured blanket tucked inside a drawer. She tugged it free with bright hope. [sighs] Instead, the fabric tore. [sadly] The girl burst into tears again and Lumo sat down in confusion, her ears drooping. She had only wanted to help.",
        mood: "well-meaning hope that turns to heartache",
        expression: "warm and hopeful, then crestfallen and gentle"
      },
      {
        text: "[whispering] That night she lay by the fire and dreamed of walking on two legs, wearing mittens and boots, and being able to speak in comforting words. [sigh] She dreamed of belonging in the warm, clever world of humans.",
        mood: "dreamy, yearning, firelit",
        expression: "soft, hushed, wistful longing"
      }
    ]
  },
  {
    id: "ch3",
    title: "Trials and Frustrations",
    mood: "restless struggle deepening into loneliness and cold",
    paragraphs: [
      {
        text: "Chapter Three",
        mood: "restless struggle",
        expression: "clear storyteller statement; pause briefly after"
      },
      {
        text: "Trials and Frustrations",
        mood: "restless struggle",
        expression: "softly stated; pause briefly after"
      },
      {
        text: "[slowly] As the cold deepened and the polar nights crept in, [sigh] stretching across the days with bluish twilight during the day and darkness at night, Lumo tried harder than ever to be human. [breath] She climbed onto tables searching for snacks and was scolded for it. She squeezed herself into the girls’ clothes, tumbling over in sleeves that tangled around her paws. She jumped on chairs and sat at the dinner table as politely as she could, [sadly] but was told to get down.",
        mood: "busy, comical effort under a darkening sky",
        expression: "earnest and flustered, a little breathless"
      },
      {
        text: "[sadly] The family grew tired of the mischievous puppy. The youngest girl was still upset about her torn blanket, [sighs] which made Lumo’s heart ache. [whispering] She felt she belonged nowhere. Too clumsy to be human, [sigh] too restless to be an ordinary dog.",
        mood: "downhearted loneliness",
        expression: "aching, quiet sadness"
      },
      {
        text: "[whispering] One particularly cold night, feeling confused and left out, she slipped through a gap in the fence and wandered into the darkness. [breath] Snow drifted down gently, softening the world into a quiet dream. The land around her was one of the most remote places in the world, [slowly] wide and silent beneath the long polar night.",
        mood: "hushed, lonely, drifting into the vast cold",
        expression: "soft and uneasy, thinning to a whisper of awe"
      }
    ]
  },
  {
    id: "ch4",
    title: "The Turning Point",
    mood: "peril and exhaustion giving way to luminous wonder and homeward comfort",
    paragraphs: [
      {
        text: "Chapter Four",
        mood: "weary suspense transitioning to awe",
        expression: "clear storyteller statement; pause briefly after"
      },
      {
        text: "The Turning Point",
        mood: "weary suspense transitioning to awe",
        expression: "softly stated; pause briefly after"
      },
      {
        text: "[whispering] Lumo wandered for hours. [breath] The snow lay deep beneath her paws and each laboured breath stung in the icy air. The wind rustled through the trees like a distant whisper. [sigh] Her strength soon faded and she curled beneath a pine tree, nose tucked beneath her tail. Her thick coat helped, but she was not warm.",
        mood: "cold, weary, fragile",
        expression: "slow and laboured, tender concern"
      },
      {
        text: "[gasp] When she woke again, the sky had transformed. [excitedly] Above her, the aurora rippled in waves of green and violet. It shimmered across the heavens as though the night itself had woken to watch over her. [breath] Wonder warmed her more than the fur on her back. [warmly] She felt a small but brave return.",
        mood: "awed, luminous, healing",
        expression: "breathless wonder rising to quiet hope"
      },
      {
        text: "[warmly] Step by slow step, guided by instinct and memory, she began to make her way home. [breath] When she reached the house it was empty. The family were out searching for her, calling her name across the fields. Lumo couldn’t hear them so she turned instead to the barn. [joyfully] Inside, the cows lay resting, warm bodies steaming in the cold. [sigh] She nestled between them, comforted by their calm breathing, and fell asleep.",
        mood: "resolute, then warm and safe",
        expression: "gentle determination easing into cosy relief"
      }
    ]
  },
  {
    id: "ch5",
    title: "The Realisation",
    mood: "relief, homecoming, and the quiet warmth of being loved",
    paragraphs: [
      {
        text: "Chapter Five",
        mood: "relief, homecoming, and quiet warmth",
        expression: "clear storyteller statement; pause briefly after"
      },
      {
        text: "The Realisation",
        mood: "relief, homecoming, and quiet warmth",
        expression: "softly stated; pause briefly after"
      },
      {
        text: "[warmly] The family found her just after dawn. [gasp] They gathered around her with relief and love. Lumo was carried back to the house, wrapped in a warm blanket, and [joyfully] the girls hugged her so tightly that she let out a tired [sigh] but contented sigh.",
        mood: "tearful relief and love",
        expression: "tender joy, a soft contented sigh"
      },
      {
        text: "[warmly] In that moment she understood that she had always belonged. She did not need boots or mittens or the power of speech. [whispering] She was loved for exactly what she was.",
        mood: "warm epiphany",
        expression: "soft, heartfelt, gently certain"
      },
      {
        text: "[cheerful] In the days that followed, the family fed her warm broth and little pieces of cooked meat. [breath] She rested by the fire and watched the windows frost with delicate snowflake patterns. [warmly] She no longer felt the desire to become something else.",
        mood: "cosy, contented resolution",
        expression: "peaceful, unhurried, at ease"
      }
    ]
  },
  {
    id: "epilogue-ch",
    title: "Spring Returns",
    mood: "renewal, joy, and a loving, whispered farewell",
    paragraphs: [
      {
        text: "Epilogue",
        mood: "renewal and joy",
        expression: "clear storyteller statement; pause briefly after"
      },
      {
        text: "Spring Returns",
        mood: "renewal and joy",
        expression: "softly stated; pause briefly after"
      },
      {
        text: "[cheerful] Spring returned slowly. [breath] Snow slid from rooftops, rivers began to run again, and the scent of pine and birch filled the warming air. [warmly] The fields turned green. Soon the midnight sun rose and the world glowed with gentle, endless daylight.",
        mood: "bright, thawing renewal",
        expression: "gentle gladness, opening and airy"
      },
      {
        text: "[joyfully] The cows were taken to pasture, and Lumo ran across the fields with the girls at her heels. [amused] She no longer stood on two legs or squeezed into their clothes. [cheerful] She was simply herself, joyous and full of life.",
        mood: "joyful freedom",
        expression: "light, playful, full of life"
      },
      {
        text: "[warmly] In the evenings, the family often told the story of the night Lumo wandered into the cold but found her way home. [whispering] The youngest girl always ended the tale by wrapping her arms around Lumo and whispering, [breath] You are the best dog in the world.",
        mood: "fond, firelit storytelling",
        expression: "warm and loving; soften almost to a whisper on ‘You are the best dog in the world’"
      },
      {
        text: "[warmly] Lumo did not need to understand the words. She felt them in every quiet moment, in every warm touch, and [whispering] in the love that embraced her like home.",
        mood: "intimate tenderness",
        expression: "soft, close, heartfelt"
      },
      {
        text: "[whispering] She was home. [breath] She was loved. [pause] And she was exactly what she was meant to be.",
        mood: "serene benediction",
        expression: "hushed and slow, a gentle final blessing with space between each line"
      }
    ]
  }
];
