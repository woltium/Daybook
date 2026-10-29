// 「今天」页顶部轮换的西方诗（都是公有领域的作品，多为节选），每 3 小时换一首。
export interface Poem {
  title: string;
  author: string;
  lines: string;
}

export const poems: Poem[] = [
  {
    title: '“Hope” is the thing with feathers',
    author: 'Emily Dickinson',
    lines: '“Hope” is the thing with feathers –\nThat perches in the soul –\nAnd sings the tune without the words –\nAnd never stops – at all –',
  },
  {
    title: 'Sonnet 18',
    author: 'William Shakespeare',
    lines:
      "Shall I compare thee to a summer's day?\nThou art more lovely and more temperate:\nRough winds do shake the darling buds of May,\nAnd summer's lease hath all too short a date;",
  },
  {
    title: 'Auguries of Innocence',
    author: 'William Blake',
    lines: 'To see a World in a Grain of Sand\nAnd a Heaven in a Wild Flower,\nHold Infinity in the palm of your hand\nAnd Eternity in an hour.',
  },
  {
    title: 'Nothing Gold Can Stay',
    author: 'Robert Frost',
    lines:
      "Nature's first green is gold,\nHer hardest hue to hold.\nHer early leaf's a flower;\nBut only so an hour.\nThen leaf subsides to leaf.\nSo Eden sank to grief,\nSo dawn goes down to day.\nNothing gold can stay.",
  },
  {
    title: 'Stopping by Woods on a Snowy Evening',
    author: 'Robert Frost',
    lines: 'The woods are lovely, dark and deep,\nBut I have promises to keep,\nAnd miles to go before I sleep,\nAnd miles to go before I sleep.',
  },
  {
    title: 'Endymion',
    author: 'John Keats',
    lines:
      'A thing of beauty is a joy for ever:\nIts loveliness increases; it will never\nPass into nothingness; but still will keep\nA bower quiet for us, and a sleep\nFull of sweet dreams, and health, and quiet breathing.',
  },
  {
    title: 'I Wandered Lonely as a Cloud',
    author: 'William Wordsworth',
    lines:
      "I wandered lonely as a cloud\nThat floats on high o'er vales and hills,\nWhen all at once I saw a crowd,\nA host, of golden daffodils;\nBeside the lake, beneath the trees,\nFluttering and dancing in the breeze.",
  },
  {
    title: 'Ulysses',
    author: 'Alfred, Lord Tennyson',
    lines:
      'Though much is taken, much abides; and though\nWe are not now that strength which in old days\nMoved earth and heaven, that which we are, we are;\nOne equal temper of heroic hearts,\nMade weak by time and fate, but strong in will\nTo strive, to seek, to find, and not to yield.',
  },
  {
    title: 'Ozymandias',
    author: 'Percy Bysshe Shelley',
    lines:
      'And on the pedestal, these words appear:\nMy name is Ozymandias, King of Kings;\nLook on my Works, ye Mighty, and despair!\nNothing beside remains. Round the decay\nOf that colossal Wreck, boundless and bare\nThe lone and level sands stretch far away.',
  },
  {
    title: 'Who Has Seen the Wind?',
    author: 'Christina Rossetti',
    lines:
      'Who has seen the wind?\nNeither I nor you:\nBut when the leaves hang trembling,\nThe wind is passing through.\n\nWho has seen the wind?\nNeither you nor I:\nBut when the trees bow down their heads,\nThe wind is passing by.',
  },
  {
    title: 'When You Are Old',
    author: 'W. B. Yeats',
    lines:
      'When you are old and grey and full of sleep,\nAnd nodding by the fire, take down this book,\nAnd slowly read, and dream of the soft look\nYour eyes had once, and of their shadows deep;',
  },
  {
    title: 'O Me! O Life!',
    author: 'Walt Whitman',
    lines: 'Answer.\nThat you are here—that life exists and identity,\nThat the powerful play goes on, and you may contribute a verse.',
  },
  {
    title: "I'm Nobody! Who are you?",
    author: 'Emily Dickinson',
    lines: "I'm Nobody! Who are you?\nAre you – Nobody – too?\nThen there's a pair of us!\nDon't tell! they'd banish us – you know!",
  },
  {
    title: 'A Red, Red Rose',
    author: 'Robert Burns',
    lines: "O my Luve is like a red, red rose\nThat's newly sprung in June;\nO my Luve is like the melody\nThat's sweetly play'd in tune.",
  },
  {
    title: 'She Walks in Beauty',
    author: 'Lord Byron',
    lines:
      "She walks in beauty, like the night\nOf cloudless climes and starry skies;\nAnd all that's best of dark and bright\nMeet in her aspect and her eyes;",
  },
  {
    title: 'To the Virgins, to Make Much of Time',
    author: 'Robert Herrick',
    lines: 'Gather ye rosebuds while ye may,\nOld Time is still a-flying;\nAnd this same flower that smiles today\nTomorrow will be dying.',
  },
];

const SLOT = 3 * 60 * 60 * 1000;

/** 按北京时间每 3 小时一档（0–3 点、3–6 点……），同一档里始终是同一首 */
export function poemAt(now = new Date()) {
  const local = now.getTime() + 8 * 3600_000;
  return poems[Math.floor(local / SLOT) % poems.length];
}
