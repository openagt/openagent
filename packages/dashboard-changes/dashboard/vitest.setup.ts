// jsdom lays nothing out, so it has no `scrollIntoView`: a click in the list scrolls the diffs to the file's.
Element.prototype.scrollIntoView ??= () => {}
// Nor `scrollTo`: "See all" in the chat scrolls the diffs to their start.
Element.prototype.scrollTo ??= () => {}
