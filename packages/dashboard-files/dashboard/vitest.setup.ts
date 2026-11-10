// jsdom lays nothing out, so it has no `scrollIntoView`: the pane calls it to keep the shown tab in view.
Element.prototype.scrollIntoView ??= () => {}
