// In-app help copy: the "How this page works" cards (PageGuide) and the
// /guide page both read from here, so the two can never disagree.
//
// Written for the creator, not for developers: plain words, short sentences,
// no em dashes (the product copy style since June), and every claim checked
// against what the code actually does. When a flow changes, update it here.

export type GuideStep = { title: string; body: string }

export type PageGuideKey =
  | 'ideas'
  | 'review'
  | 'reviewDetail'
  | 'library'
  | 'edit'
  | 'studio'
  | 'publish'
  | 'settings'

export type PageGuideContent = {
  title: string
  steps: GuideStep[]
  tip?: string
  /** Section id on /guide that explains this page in more depth. */
  anchor: GuideSectionId
}

export type GuideSectionId =
  | 'start' | 'ideas' | 'review' | 'film' | 'studio' | 'styles' | 'options'
  | 'publish' | 'library' | 'settings' | 'labels' | 'problems' | 'faq'

export const PAGE_GUIDES: Record<PageGuideKey, PageGuideContent> = {
  ideas: {
    title: 'Turn a thought into a script',
    steps: [
      { title: 'Choose how to start', body: 'AI-assisted: type a rough idea. Generate 10 ideas: let Olympus suggest topics from your brand. Paste my script: use words you already wrote.' },
      { title: 'Pick a tone and a format', body: 'Tone is how it sounds (calm, bold, and so on). Format is its shape (tips, a story, myth busting). AI-assisted needs both.' },
      { title: 'Let it write', body: 'In about 30 seconds Olympus picks the right audience, looks up the topic, and writes the hook, body, and call to action.' },
      { title: 'Check it in Review', body: 'The new script opens straight away. Nothing is ever posted until you publish it yourself.' },
    ],
    tip: 'Keep “Use brand context” on so scripts sound like you. Turn it off only for an idea outside your usual topics.',
    anchor: 'ideas',
  },
  review: {
    title: 'Decide which scripts get filmed',
    steps: [
      { title: 'Open a script', body: '“Needs review” holds new scripts. “Revision requested” holds the ones you sent back with notes.' },
      { title: 'Approve, revise, or reject', body: 'Approve what sounds like you. Revise to tell the AI what to change. Reject to drop it for good.' },
      { title: 'Approved scripts move on', body: 'They go to your Library and to Edit, ready to film.' },
    ],
    tip: 'Every approval teaches Olympus your voice, so each script you approve makes the next ones better.',
    anchor: 'review',
  },
  reviewDetail: {
    title: 'Read it, tweak it, film it',
    steps: [
      { title: 'Read it through', body: 'The script is split into beats: the hook (first 3 seconds), the body, and the call to action. “Why this works” explains the thinking.' },
      { title: 'Make it yours', body: 'Tap Edit to change any word, or tap another opener to swap the hook. Revise asks the AI for a new version from your notes.' },
      { title: 'Approve when it is right', body: 'Approving sends it to the video studio and teaches Olympus your style.' },
      { title: 'Film with the teleprompter', body: '“Read it on camera” scrolls the words for you. The filming plan below covers shot, setup, and outfit.' },
    ],
    anchor: 'review',
  },
  library: {
    title: 'Every script you have approved',
    steps: [
      { title: 'Find a script', body: 'All approved scripts live here, newest first. The tabs at the top filter by folder.' },
      { title: 'Organise with folders', body: 'Make a folder with “New folder”, then use the ⋯ menu on a card to move a script into it.' },
      { title: 'Jump back in', body: 'The ⋯ menu also opens the script or its video studio, or removes an edit to free up storage.' },
    ],
    tip: 'Deleting a folder never deletes scripts. They simply become unfiled.',
    anchor: 'library',
  },
  edit: {
    title: 'From approved script to finished video',
    steps: [
      { title: 'Needs footage', body: 'Approved but not filmed yet. Tap “Add footage” once your recording is in Google Drive.' },
      { title: 'Processing', body: 'Olympus is editing. You can close the app; it keeps going.' },
      { title: 'Pick a variant', body: 'Your edited versions are ready. Watch them and choose your favourite.' },
      { title: 'Done', body: 'You have picked one. Tap “Publish →” to post it.' },
    ],
    anchor: 'studio',
  },
  studio: {
    title: 'Add your footage, get up to six edits',
    steps: [
      { title: 'Share your recording', body: 'Upload the video to Google Drive, set sharing to “Anyone with the link”, paste the link, and tap “Confirm video”.' },
      { title: 'Choose options, or leave them', body: 'Music, color look, and B-roll start on Smart, which suits most videos. Tap the ? next to each one to see what it does.' },
      { title: 'Start the edit', body: 'Olympus downloads your footage once, cleans up the sound, and cuts out retakes. You can leave while it works.' },
      { title: 'Start the styles you want', body: 'Each version is a different editing style. Tap “Start now” on one, or start them all. Each takes around 20 minutes.' },
      { title: 'Pick one and publish', body: 'Watch the finished versions, then tap “Publish this” on your favourite.' },
    ],
    tip: 'Each version is a full edit that uses credits, so start the styles you like rather than retrying the same one many times.',
    anchor: 'studio',
  },
  publish: {
    title: 'Post everywhere at once',
    steps: [
      { title: 'Choose platforms', body: 'Instagram, Facebook, TikTok, and YouTube start switched on. Tap one to leave it out.' },
      { title: 'Pick the video', body: 'Choose a finished version from your library. A green tick means that version already went out.' },
      { title: 'Check the captions', body: 'Olympus writes one caption per platform, sized to fit. Edit any of them, or use “Rewrite with feedback”.' },
      { title: 'Publish now or schedule', body: 'Scheduling lets you pick a day and time. The calendar shows what is already planned.' },
    ],
    tip: 'If one platform fails and the rest work, the result says which one. Fix it (usually by reconnecting it in Blotato), then publish again with only that platform selected.',
    anchor: 'publish',
  },
  settings: {
    title: 'Teach Olympus your voice',
    steps: [
      { title: 'Describe your brand', body: 'Name, background, tone, audience, and results. The more specific you are, the more every script sounds like you.' },
      { title: 'Set your rules', body: 'Section 07 lists what every script must, or must never, do. They apply to every script Olympus writes.' },
      { title: 'Save', body: 'Changes apply from the next script on. Scripts you already have stay as they are.' },
    ],
    tip: 'Your social accounts connect through Blotato (section 08). If a platform stops posting, reconnect it there.',
    anchor: 'settings',
  },
}

// ── Longer copy for the /guide page ─────────────────────────────────────────

export const BIG_PICTURE: { step: string; you: string; olympus: string; time: string }[] = [
  { step: 'Idea', you: 'Type a rough idea, or ask for 10 suggestions.', olympus: 'Picks the audience, looks up the topic, and writes the script.', time: 'About 1 minute' },
  { step: 'Review', you: 'Read it, tweak it, approve it.', olympus: 'Learns your voice from every approval.', time: 'A few minutes' },
  { step: 'Film', you: 'Record with the teleprompter, then upload to Google Drive.', olympus: 'Gives you the filming plan: shot, setup, outfit.', time: 'Your pace' },
  { step: 'Edit', you: 'Paste the Drive link and start the styles you want.', olympus: 'Cleans the sound, cuts retakes, adds captions, music, and B-roll.', time: 'About 20 to 40 minutes, hands off' },
  { step: 'Publish', you: 'Pick a version, check the captions, publish or schedule.', olympus: 'Writes a caption per platform and posts everywhere.', time: 'A couple of minutes' },
]

export type GuideOption = { name: string; body: string }

export const STUDIO_OPTIONS: { title: string; intro: string; options: GuideOption[] }[] = [
  {
    title: 'Background music',
    intro: 'Applies to all six versions.',
    options: [
      { name: 'Smart', body: 'Picks a track from your music library that fits the mood of the script, and keeps it softly under your voice.' },
      { name: 'No music', body: 'Just your voice.' },
    ],
  },
  {
    title: 'Color look',
    intro: 'How the footage is color-graded.',
    options: [
      { name: 'Smart', body: 'Each style gets its own look: warm and natural for most, dark and cinematic for Cinematic.' },
      { name: 'Golden, Clean, or Moody', body: 'Puts the same look on every version: warm and sunny, crisp and true-to-life, or dark and cinematic.' },
      { name: 'Natural', body: 'Leaves the color exactly as you filmed it.' },
    ],
  },
  {
    title: 'B-roll',
    intro: 'B-roll is the short cutaway footage shown over your voice, to illustrate what you are saying.',
    options: [
      { name: 'Smart', body: 'Reads your footage and chooses how much B-roll suits each style.' },
      { name: 'Pick the exact amount', body: 'You set it with the slider, from 5% (light) to 50% (a lot) of the video.' },
      { name: 'None', body: 'Only you on camera, no cutaways.' },
    ],
  },
  {
    title: 'Your own B-roll',
    intro: 'Optional. Paste a Google Drive folder of your own clips (up to 12) and tap “Confirm B-roll”.',
    options: [
      { name: 'Smart', body: 'Uses your clips where they match what you are saying, and fills the rest with stock footage. If none of your clips fit, it uses stock only, and the card says so.' },
      { name: 'Only mine', body: 'Uses only your clips, no stock.' },
      { name: 'Only stock', body: 'Ignores your clips this time.' },
    ],
  },
]

export const LABELS: { group: string; items: GuideOption[] }[] = [
  {
    group: 'Scripts',
    items: [
      { name: 'Needs review', body: 'A new script waiting for your decision.' },
      { name: 'Revision requested', body: 'You asked for changes. Open it and tap “Generate revision” to get the new version.' },
      { name: 'Approved', body: 'Ready to film. It is in your Library and in Edit.' },
    ],
  },
  {
    group: 'Video versions',
    items: [
      { name: 'Not started', body: 'This style has not been started. Tap “Start now” when you want it.' },
      { name: 'Processing', body: 'Being edited. The label shows the current step. “Waiting in line” or “Waiting for a free render slot” just means other videos are ahead; it starts on its own.' },
      { name: 'Recovering', body: 'Something hiccuped and Olympus restarted it automatically. Nothing for you to do.' },
      { name: 'Ready', body: 'Finished. Watch it, download it, or tap “Publish this”.' },
      { name: 'Failed', body: 'It could not finish. The red message says why, and usually what to do.' },
    ],
  },
  {
    group: 'Publishing',
    items: [
      { name: 'Published', body: 'Posted on every platform you selected.' },
      { name: 'Scheduled', body: 'Queued to post at the time you picked.' },
      { name: 'Partial', body: 'Posted on some platforms but not others. The result shows which one failed and why.' },
      { name: 'Failed', body: 'Nothing was posted. The message explains why.' },
    ],
  },
]

export const PROBLEMS: { problem: string; fix: string }[] = [
  {
    problem: '“That video is not accessible” when confirming the Drive link',
    fix: 'In Google Drive, right-click the video, choose Share, and under “General access” pick “Anyone with the link” (role: Viewer). Copy the link again and paste it in. Make sure it is the video file itself, not the folder.',
  },
  {
    problem: 'A large .MOV file fails to download',
    fix: 'Google sometimes blocks big MOV files with a virus-scan warning. Export or save the video as MP4 and upload that instead.',
  },
  {
    problem: '“The footage is still being prepared”',
    fix: 'Olympus is still getting your recording ready. Give it a minute or two, then tap Start again.',
  },
  {
    problem: 'A version says it failed',
    fix: 'Read the red message. If it shows a button (for example to top up credits), do that first. Otherwise tap Retry: most failures are temporary. Each retry is a full edit, so avoid retrying the same one again and again.',
  },
  {
    problem: 'A version has been processing for a long time',
    fix: 'Each version takes around 20 minutes, longer when several run at once. If a render gets stuck, Olympus notices and restarts it automatically. You can safely close the app and come back.',
  },
  {
    problem: '“Needs reconnecting in Blotato” or “Page / subaccount not found”',
    fix: 'That social account lost its connection. Open my.blotato.com, go to Accounts, and reconnect it (for Facebook, choose your Page when asked). Then publish again with only that platform selected.',
  },
  {
    problem: '“Partially published: some platforms failed”',
    fix: 'The other platforms already posted. Fix the one that failed, then publish again with only that platform selected, so the others do not get a second copy.',
  },
  {
    problem: '“Blotato did not answer in time”',
    fix: 'The post may still go out. Check the Blotato calendar before publishing again, so it does not post twice.',
  },
  {
    problem: 'Captions cover my face',
    fix: 'Frame yourself with your head in the upper third of the shot, leaving the lower part of the frame for captions. Then open the script in Edit, tap “Use new footage”, and paste the new recording.',
  },
  {
    problem: 'Storage is getting full',
    fix: 'In Settings, section 09, tap “Clear working files”. It removes only the raw footage used to make videos. Every finished video stays.',
  },
]

export const FAQ: { q: string; a: string }[] = [
  { q: 'Will anything post without me?', a: 'No. Nothing goes out until you press Publish or Schedule on the Publish page.' },
  { q: 'Can I close the app while a video is editing?', a: 'Yes. Editing happens on the server and keeps going. Your versions will be waiting in Edit when you come back.' },
  { q: 'Why are there six versions?', a: 'Each is a different editing style, and different topics suit different styles. Start only the ones you want. You never have to use all six.' },
  { q: 'Does retrying cost anything?', a: 'Yes. Every render is a full edit that uses editing and AI credits, so retry when there is a reason to, not just to see a different take.' },
  { q: 'Can I post the same video twice?', a: 'Yes. Olympus warns you first, in case it was not on purpose.' },
  { q: 'Where are my finished videos?', a: 'In the studio page for that script (Edit, then the script), and in Publish under “From library”. Each finished version has a download button.' },
  { q: 'How do I change which social accounts are used?', a: 'Accounts are connected in Blotato. Open Settings, section 08, and tap “Manage in Blotato”.' },
  { q: 'How do I refilm a script that already has edits?', a: 'Open the script in Edit and tap “Use new footage” under the versions. Paste the link to your new recording and start the edit. Your old versions stay until you start, and anything you already posted stays posted.' },
  { q: 'What if a script is not quite right?', a: 'Tap Edit to change the words yourself, or Revise and tell the AI what to change. Revising creates a fresh version for you to review.' },
]
