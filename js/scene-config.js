/*
 * Geometry of the moon illustration, in the image's own pixel coordinates
 * (1672 × 941). The intro camera, the final framing and the star glints are
 * all computed from these numbers, so the same image is used from the first
 * close-up to the final view.
 *
 * If the illustration changes, re-measure these values and rebuild the detail
 * tile with tools/build-assets.cjs.
 */
window.SCENE = {
  image: { src: 'assets/scene/moon-scene.webp', width: 1672, height: 941 },

  // Everything that must stay in frame at the end: scarf tip on the left,
  // tree leaves on the right, top of the tree, bottom of the moon.
  content: { x0: 486, y0: 22, x1: 1252, y1: 900 },

  // Opening close-up: an even, warm patch of moon surface away from the
  // characters, the tree and the rim. `radius` is how many image pixels are
  // visible from the screen centre to a screen corner, for every aspect ratio.
  // Tall screens start lower-left on the lit side, so the rim and black sky
  // still appear before the boy, the fox and the tree.
  start: {
    focus: [712, 537],
    radius: 50,
    portrait: { focus: [686, 600], minAspect: 1.15 }
  },

  // Softer high-resolution copy of the close-up (built by tools/build-assets.cjs).
  // It sits exactly on top of the same image area and fades out early in the
  // pull-back. Centre (cx, cy) and feather radii `solid` / `fade` in image px.
  detail: {
    src: 'assets/scene/moon-detail.webp',
    x: 562, y: 433, size: 300, px: 1200,
    cx: 712, cy: 583, solid: 105, fade: 145
  },

  // Colour shown before the image is decoded (average of the opening view).
  cream: '#f5e0c1',

  // Bright stars already painted in the image; a few get a slow, faint glint.
  stars: [
    [1482, 159], [209, 263], [1399, 823], [543, 90],
    [192, 582], [434, 752], [1274, 625], [1578, 77]
  ]
};
