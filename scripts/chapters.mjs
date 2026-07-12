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
    id: "ch1",
    title: "A Puppy’s World",
    mood: "warm, cosy, pastoral wonder — the safe world of a beloved puppy",
    paragraphs: [
      {
        text: "Lumo was a six-month-old Australian Shepherd puppy who lived on a small farm outside a quiet arctic town. The farm was home to cows rather than sheep, which an Aussie would usually herd instead, though she did not mind. The cows smelled warm and friendly, and the fields were full of flowers and scents she had not yet explored. In summer, cloudberries glowed like tiny amber lanterns across the bushes, though she was not allowed to eat them.",
        mood: "gentle, sunlit introduction",
        expression: "soft curiosity and delight, unhurried"
      },
      {
        text: "The family who cared for her consisted of a hardworking father, a kind mother, and two lively daughters aged four and seven. The girls adored Lumo and often napped with her curled between them. She adored them just as much, though her curiosity and tendency to be mischievous often tempted her to wriggle through small gaps in the fence to explore the surrounding fields. But she always returned. She loved the girls too deeply to stay away for long.",
        mood: "tender, affectionate family warmth",
        expression: "loving fondness with a small playful smile"
      },
      {
        text: "Each morning she watched the humans dress in warm clothes, share breakfast, and begin their day. Lumo ate her dry food, sometimes with a tin of wet food mixed in. Unofficially, the girls slipped her scraps of rye bread, cheese, cold meats, or a bit of boiled egg. She could smell egg from the other side of the house and zoomed towards it every time.",
        mood: "cosy domestic routine, gently comic",
        expression: "light amusement, a twinkle on the egg"
      },
      {
        text: "As the season edged towards winter and the cold grew sharper, Lumo watched the girls wrap themselves in woollen layers. Woven dog coats were uncommon in the region and the parents believed Lumo’s thick fur was enough. Lumo was not so sure. She wondered why she could not wear warm clothes too. Perhaps humans were simply allowed more comforts. Perhaps, she thought, she ought to become one herself.",
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
        text: "Lumo began practising. She tried standing on her hind legs, wobbling proudly like a little dancer. She jumped so high that her nose nearly met the father’s face to impress him. She attempted human sounds too, producing half-barks and curious noises as if mimicking speech.",
        mood: "eager, comic determination",
        expression: "playful, bright, affectionately amused"
      },
      {
        text: "One day the youngest girl tripped and scraped her knee. She cried with great sorrow. Lumo wanted desperately to make it better. She sniffed around the room for something helpful and found the girl’s treasured blanket tucked inside a drawer. She tugged it free with bright hope. Instead, the fabric tore. The girl burst into tears again and Lumo sat down in confusion, her ears drooping. She had only wanted to help.",
        mood: "well-meaning hope that turns to heartache",
        expression: "warm and hopeful, then crestfallen and gentle"
      },
      {
        text: "That night she lay by the fire and dreamed of walking on two legs, wearing mittens and boots, and being able to speak in comforting words. She dreamed of belonging in the warm, clever world of humans.",
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
        text: "As the cold deepened and the polar nights crept in, stretching across the days with bluish twilight during the day and darkness at night, Lumo tried harder than ever to be human. She climbed onto tables searching for snacks and was scolded for it. She squeezed herself into the girls’ clothes, tumbling over in sleeves that tangled around her paws. She jumped on chairs and sat at the dinner table as politely as she could, but was told to get down.",
        mood: "busy, comical effort under a darkening sky",
        expression: "earnest and flustered, a little breathless"
      },
      {
        text: "The family grew tired of the mischievous puppy. The youngest girl was still upset about her torn blanket, which made Lumo’s heart ache. She felt she belonged nowhere. Too clumsy to be human, too restless to be an ordinary dog.",
        mood: "downhearted loneliness",
        expression: "aching, quiet sadness"
      },
      {
        text: "One particularly cold night, feeling confused and left out, she slipped through a gap in the fence and wandered into the darkness. Snow drifted down gently, softening the world into a quiet dream. The land around her was one of the most remote places in the world, wide and silent beneath the long polar night.",
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
        text: "Lumo wandered for hours. The snow lay deep beneath her paws and each laboured breath stung in the icy air. The wind rustled through the trees like a distant whisper. Her strength soon faded and she curled beneath a pine tree, nose tucked beneath her tail. Her thick coat helped, but she was not warm.",
        mood: "cold, weary, fragile",
        expression: "slow and laboured, tender concern"
      },
      {
        text: "When she woke again, the sky had transformed. Above her, the aurora rippled in waves of green and violet. It shimmered across the heavens as though the night itself had woken to watch over her. Wonder warmed her more than the fur on her back. She felt a small but brave return.",
        mood: "awed, luminous, healing",
        expression: "breathless wonder rising to quiet hope"
      },
      {
        text: "Step by slow step, guided by instinct and memory, she began to make her way home. When she reached the house it was empty. The family were out searching for her, calling her name across the fields. Lumo couldn’t hear them so she turned instead to the barn. Inside, the cows lay resting, warm bodies steaming in the cold. She nestled between them, comforted by their calm breathing, and fell asleep.",
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
        text: "The family found her just after dawn. They gathered around her with relief and love. The father carried her back to the house, the mother wrapped her in a blanket, and the youngest girl hugged her so tightly that Lumo let out a tired but contented sigh.",
        mood: "tearful relief and love",
        expression: "tender joy, a soft contented sigh"
      },
      {
        text: "In that moment she understood that she had always belonged. She did not need boots or mittens or the power of speech. She was loved for exactly what she was.",
        mood: "warm epiphany",
        expression: "soft, heartfelt, gently certain"
      },
      {
        text: "In the days that followed, the family fed her warm broth and little pieces of cooked meat. She rested by the fire and watched the windows frost with delicate snowflake patterns. She no longer felt the desire to become something else.",
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
        text: "Spring returned slowly. Snow slid from rooftops, rivers began to run again, and the scent of pine and birch filled the warming air. The fields turned green. Soon the midnight sun rose and the world glowed with gentle, endless daylight.",
        mood: "bright, thawing renewal",
        expression: "gentle gladness, opening and airy"
      },
      {
        text: "The cows were taken to pasture, and Lumo ran across the fields with the girls at her heels. She no longer stood on two legs or squeezed into their clothes. She was simply herself, joyous and full of life.",
        mood: "joyful freedom",
        expression: "light, playful, full of life"
      },
      {
        text: "In the evenings, the family often told the story of the night Lumo wandered into the cold but found her way home. The youngest girl always ended the tale by wrapping her arms around Lumo and whispering, You are the best dog in the world.",
        mood: "fond, firelit storytelling",
        expression: "warm and loving; soften almost to a whisper on ‘You are the best dog in the world’"
      },
      {
        text: "Lumo did not need to understand the words. She felt them in every quiet moment, in every warm touch, and in the love that embraced her like home.",
        mood: "intimate tenderness",
        expression: "soft, close, heartfelt"
      },
      {
        text: "She was home. She was loved. And she was exactly what she was meant to be.",
        mood: "serene benediction",
        expression: "hushed and slow, a gentle final blessing with space between each line"
      }
    ]
  }
];
