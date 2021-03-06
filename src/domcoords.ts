import { nodeSize, textRange, parentNode } from "./dom";
import browser from "./browser";
import { EditorView } from ".";
import { ICoords, IDir } from "./types";
import { EditorState } from "prosemirror-state";

function windowRect(doc: Document) {
  return { left: 0, right: doc.documentElement.clientWidth, top: 0, bottom: doc.documentElement.clientHeight };
}

function getSide(value: number | { [key: string]: number }, side: string) {
  return typeof value == "number" ? value : value[side];
}

function clientRect(node: HTMLElement) {
  let rect = node.getBoundingClientRect();
  // Make sure scrollbar width isn't included in the rectangle
  return { left: rect.left, right: rect.left + node.clientWidth, top: rect.top, bottom: rect.top + node.clientHeight };
}

export function scrollRectIntoView(
  view: EditorView,
  rect: { left: number; right: number; top: number; bottom: number },
  startDOM: HTMLElement
) {
  let scrollThreshold = view.someProp("scrollThreshold") || 0,
    scrollMargin = view.someProp("scrollMargin") || 5;
  let doc = view.dom.ownerDocument;
  for (let parent = startDOM || view.dom; ; parent = parentNode(parent)) {
    if (!parent) break;
    if (parent.nodeType != 1) continue;
    let atTop = parent == doc.body || parent.nodeType != 1;
    let bounding = atTop ? windowRect(doc) : clientRect(parent);
    let moveX = 0,
      moveY = 0;
    if (rect.top < bounding.top + getSide(scrollThreshold, "top"))
      moveY = -(bounding.top - rect.top + getSide(scrollMargin, "top"));
    else if (rect.bottom > bounding.bottom - getSide(scrollThreshold, "bottom"))
      moveY = rect.bottom - bounding.bottom + getSide(scrollMargin, "bottom");
    if (rect.left < bounding.left + getSide(scrollThreshold, "left"))
      moveX = -(bounding.left - rect.left + getSide(scrollMargin, "left"));
    else if (rect.right > bounding.right - getSide(scrollThreshold, "right"))
      moveX = rect.right - bounding.right + getSide(scrollMargin, "right");
    if (moveX || moveY) {
      if (atTop) {
        doc.defaultView.scrollBy(moveX, moveY);
      } else {
        let startX = parent.scrollLeft,
          startY = parent.scrollTop;
        if (moveY) parent.scrollTop += moveY;
        if (moveX) parent.scrollLeft += moveX;
        let dX = parent.scrollLeft - startX,
          dY = parent.scrollTop - startY;
        rect = { left: rect.left - dX, top: rect.top - dY, right: rect.right - dX, bottom: rect.bottom - dY };
      }
    }
    if (atTop) break;
  }
}

// Store the scroll position of the editor's parent nodes, along with
// the top position of an element near the top of the editor, which
// will be used to make sure the visible viewport remains stable even
// when the size of the content above changes.
export function storeScrollPos(view: EditorView) {
  let rect = view.dom.getBoundingClientRect(),
    startY = Math.max(0, rect.top);
  let refDOM: Element, refTop: number;
  for (let x = (rect.left + rect.right) / 2, y = startY + 1; y < Math.min(innerHeight, rect.bottom); y += 5) {
    let dom = (view.root as Document).elementFromPoint(x, y);
    if (dom == view.dom || !view.dom.contains(dom)) continue;
    let localRect = dom.getBoundingClientRect();
    if (localRect.top >= startY - 20) {
      refDOM = dom;
      refTop = localRect.top;
      break;
    }
  }
  return { refDOM, refTop, stack: scrollStack(view.dom) };
}

function scrollStack(dom: HTMLElement) {
  let stack = [],
    doc = dom.ownerDocument;
  for (; dom; dom = parentNode(dom)) {
    stack.push({ dom, top: dom.scrollTop, left: dom.scrollLeft });
    if (dom == (doc as any)) break;
  }
  return stack;
}

// Reset the scroll position of the editor's parent nodes to that what
// it was before, when storeScrollPos was called.
export function resetScrollPos({ refDOM, refTop, stack }) {
  let newRefTop = refDOM ? refDOM.getBoundingClientRect().top : 0;
  restoreScrollStack(stack, newRefTop == 0 ? 0 : newRefTop - refTop);
}

function restoreScrollStack(stack: Array<{ dom: HTMLElement; top: number; left: number }>, dTop: number) {
  for (let i = 0; i < stack.length; i++) {
    let { dom, top, left } = stack[i];
    if (dom.scrollTop != top + dTop) dom.scrollTop = top + dTop;
    if (dom.scrollLeft != left) dom.scrollLeft = left;
  }
}

let preventScrollSupported = null;
// Feature-detects support for .focus({preventScroll: true}), and uses
// a fallback kludge when not supported.
export function focusPreventScroll(dom: HTMLElement) {
  if ((dom as any).setActive) return (dom as any).setActive(); // in IE
  if (preventScrollSupported) return dom.focus(preventScrollSupported);

  let stored = scrollStack(dom);
  dom.focus(
    preventScrollSupported == null
      ? {
          get preventScroll() {
            preventScrollSupported = { preventScroll: true };
            return true;
          },
        }
      : undefined
  );
  if (!preventScrollSupported) {
    preventScrollSupported = false;
    restoreScrollStack(stored, 0);
  }
}

function findOffsetInNode(node: Node, coords: ICoords) {
  let closest: ChildNode,
    dxClosest = 2e8,
    coordsClosest: ICoords,
    offset = 0;
  let rowBot = coords.top,
    rowTop = coords.top;
  for (let child = node.firstChild, childIndex = 0; child; child = child.nextSibling, childIndex++) {
    let rects: DOMRectList;
    if (child.nodeType == 1) rects = (child as HTMLElement).getClientRects();
    else if (child.nodeType == 3) rects = textRange(child).getClientRects();
    else continue;

    for (let i = 0; i < rects.length; i++) {
      let rect = rects[i];
      if (rect.top <= rowBot && rect.bottom >= rowTop) {
        rowBot = Math.max(rect.bottom, rowBot);
        rowTop = Math.min(rect.top, rowTop);
        let dx =
          rect.left > coords.left ? rect.left - coords.left : rect.right < coords.left ? coords.left - rect.right : 0;
        if (dx < dxClosest) {
          closest = child;
          dxClosest = dx;
          coordsClosest =
            dx && closest.nodeType == 3
              ? { left: rect.right < coords.left ? rect.right : rect.left, top: coords.top }
              : coords;
          if (child.nodeType == 1 && dx) offset = childIndex + (coords.left >= (rect.left + rect.right) / 2 ? 1 : 0);
          continue;
        }
      }
      if (
        !closest &&
        ((coords.left >= rect.right && coords.top >= rect.top) ||
          (coords.left >= rect.left && coords.top >= rect.bottom))
      )
        offset = childIndex + 1;
    }
  }
  if (closest && closest.nodeType == 3) return findOffsetInText(closest, coordsClosest);
  if (!closest || (dxClosest && closest.nodeType == 1)) return { node, offset };
  return findOffsetInNode(closest, coordsClosest);
}

function findOffsetInText(node: Node, coords: ICoords) {
  let len = node.nodeValue.length;
  let range = document.createRange();
  for (let i = 0; i < len; i++) {
    range.setEnd(node, i + 1);
    range.setStart(node, i);
    let rect = singleRect(range, 1);
    if (rect.top == rect.bottom) continue;
    if (inRect(coords, rect)) return { node, offset: i + (coords.left >= (rect.left + rect.right) / 2 ? 1 : 0) };
  }
  return { node, offset: 0 };
}

function inRect(coords: ICoords, rect: DOMRect) {
  return (
    coords.left >= rect.left - 1 &&
    coords.left <= rect.right + 1 &&
    coords.top >= rect.top - 1 &&
    coords.top <= rect.bottom + 1
  );
}

function targetKludge(dom: HTMLElement, coords: ICoords) {
  let parent = dom.parentNode;
  if (parent && /^li$/i.test(parent.nodeName) && coords.left < dom.getBoundingClientRect().left) return parent;
  return dom;
}

function posFromElement(view: EditorView, elt: Node, coords: ICoords) {
  let { node, offset } = findOffsetInNode(elt, coords),
    bias = -1;
  if (node.nodeType == 1 && !node.firstChild) {
    let rect = node.getBoundingClientRect();
    bias = rect.left != rect.right && coords.left > (rect.left + rect.right) / 2 ? 1 : -1;
  }
  return view.docView.posFromDOM(node, offset, bias);
}

function posFromCaret(view: EditorView, node: Node, offset: number, coords: ICoords) {
  // Browser (in caretPosition/RangeFromPoint) will agressively
  // normalize towards nearby inline nodes. Since we are interested in
  // positions between block nodes too, we first walk up the hierarchy
  // of nodes to see if there are block nodes that the coordinates
  // fall outside of. If so, we take the position before/after that
  // block. If not, we call `posFromDOM` on the raw node/offset.
  let outside = -1;
  for (let cur = node; ; ) {
    if (cur == view.dom) break;
    let desc = view.docView.nearestDesc(cur, true);
    if (!desc) return null;
    if (desc.node.isBlock && desc.parent) {
      let rect = (desc.dom as HTMLElement).getBoundingClientRect();
      if (rect.left > coords.left || rect.top > coords.top) outside = desc.posBefore;
      else if (rect.right < coords.left || rect.bottom < coords.top) outside = desc.posAfter;
      else break;
    }
    cur = desc.dom.parentNode;
  }
  return outside > -1 ? outside : view.docView.posFromDOM(node, offset);
}

function elementFromPoint(element: HTMLElement, coords: ICoords, box: ICoords) {
  let len = element.childNodes.length;
  if (len && box.top < box.bottom) {
    for (
      let startI = Math.max(
          0,
          Math.min(len - 1, Math.floor((len * (coords.top - box.top)) / (box.bottom - box.top)) - 2)
        ),
        i = startI;
      ;

    ) {
      let child = element.childNodes[i];
      if (child.nodeType == 1) {
        let rects = (child as HTMLElement).getClientRects();
        for (let j = 0; j < rects.length; j++) {
          let rect = rects[j];
          if (inRect(coords, rect)) return elementFromPoint(child as HTMLElement, coords, rect);
        }
      }
      if ((i = (i + 1) % len) == startI) break;
    }
  }
  return element;
}

// Given an x,y position on the editor, get the position in the document.
export function posAtCoords(view: EditorView, coords: ICoords) {
  let root = view.root as Document,
    node: Node,
    offset: number;
  if (root.caretPositionFromPoint) {
    try {
      // Firefox throws for this call in hard-to-predict circumstances (#994)
      let pos = root.caretPositionFromPoint(coords.left, coords.top);
      if (pos) ({ offsetNode: node, offset } = pos);
    } catch (_) {}
  }
  if (!node && root.caretRangeFromPoint) {
    let range = root.caretRangeFromPoint(coords.left, coords.top);
    if (range) ({ startContainer: node, startOffset: offset } = range);
  }

  let elt: Element | HTMLElement = root.elementFromPoint(coords.left, coords.top + 1),
    pos: number;
  if (!elt || !view.dom.contains(elt.nodeType != 1 ? elt.parentNode : elt)) {
    let box = view.dom.getBoundingClientRect();
    if (!inRect(coords, box)) return null;
    elt = elementFromPoint(view.dom, coords, box);
    if (!elt) return null;
  }
  // Safari's caretRangeFromPoint returns nonsense when on a draggable element
  if (browser.safari && (elt as HTMLElement).draggable) node = offset = null;
  elt = targetKludge(elt as HTMLElement, coords) as any;
  if (node) {
    if (browser.gecko && node.nodeType == 1) {
      // Firefox will sometimes return offsets into <input> nodes, which
      // have no actual children, from caretPositionFromPoint (#953)
      offset = Math.min(offset, node.childNodes.length);
      // It'll also move the returned position before image nodes,
      // even if those are behind it.
      if (offset < node.childNodes.length) {
        let next = node.childNodes[offset],
          box: ICoords;
        if (
          next.nodeName == "IMG" &&
          (box = (next as HTMLImageElement).getBoundingClientRect()).right <= coords.left &&
          box.bottom > coords.top
        )
          offset++;
      }
    }
    // Suspiciously specific kludge to work around caret*FromPoint
    // never returning a position at the end of the document
    if (
      node == view.dom &&
      offset == node.childNodes.length - 1 &&
      node.lastChild.nodeType == 1 &&
      coords.top > (node.lastChild as HTMLElement).getBoundingClientRect().bottom
    )
      pos = view.state.doc.content.size;
    // Ignore positions directly after a BR, since caret*FromPoint
    // 'round up' positions that would be more accurately placed
    // before the BR node.
    else if (offset == 0 || node.nodeType != 1 || node.childNodes[offset - 1].nodeName != "BR")
      pos = posFromCaret(view, node, offset, coords);
  }
  if (pos == null) pos = posFromElement(view, elt, coords);

  let desc = view.docView.nearestDesc(elt, true);
  return { pos, inside: desc ? desc.posAtStart - desc.border : -1 };
}

function singleRect(object: Range | HTMLElement, bias?: number) {
  let rects = object.getClientRects();
  return !rects.length ? object.getBoundingClientRect() : rects[bias < 0 ? 0 : rects.length - 1];
}

// : (EditorView, number) → {left: number, top: number, right: number, bottom: number}
// Given a position in the document model, get a bounding box of the
// character at that position, relative to the window.
export function coordsAtPos(view: EditorView, pos: number) {
  let { node, offset } = view.docView.domFromPos(pos);

  // These browsers support querying empty text ranges
  if (node.nodeType == 3 && (browser.webkit || browser.gecko)) {
    let rect = singleRect(textRange(node, offset, offset), 0);
    // Firefox returns bad results (the position before the space)
    // when querying a position directly after line-broken
    // whitespace. Detect this situation and and kludge around it
    if (browser.gecko && offset && /\s/.test(node.nodeValue[offset - 1]) && offset < node.nodeValue.length) {
      let rectBefore = singleRect(textRange(node, offset - 1, offset - 1), -1);
      if (rectBefore.top == rect.top) {
        let rectAfter = singleRect(textRange(node, offset, offset + 1), -1);
        if (rectAfter.top != rect.top) return flattenV(rectAfter, rectAfter.left < rectBefore.left);
      }
    }
    return rect;
  }

  if (node.nodeType == Node.ELEMENT_NODE && !view.state.doc.resolve(pos).parent.inlineContent) {
    // Return a horizontal line in block context
    let top = true,
      rect: DOMRect;
    if (offset < node.childNodes.length) {
      let after = node.childNodes[offset] as HTMLElement;
      if (after.nodeType == Node.ELEMENT_NODE) rect = after.getBoundingClientRect();
    }
    if (!rect && offset) {
      let before = node.childNodes[offset - 1] as HTMLElement;
      if (before.nodeType == Node.ELEMENT_NODE) {
        rect = before.getBoundingClientRect();
        top = false;
      }
    }
    return flattenH(rect || (node as HTMLElement).getBoundingClientRect(), top);
  }

  // Not Firefox/Chrome, or not in a text node, so we have to use
  // actual element/character rectangles to get a solution (this part
  // is not very bidi-safe)
  //
  // Try the left side first, fall back to the right one if that
  // doesn't work.
  for (let dir = -1; dir < 2; dir += 2) {
    if (dir < 0 && offset) {
      let prev: Node,
        target =
          node.nodeType == Node.TEXT_NODE
            ? textRange(node, offset - 1, offset)
            : (prev = node.childNodes[offset - 1]).nodeType == Node.TEXT_NODE
            ? textRange(prev)
            : prev.nodeType == Node.ELEMENT_NODE && prev.nodeName != "BR"
            ? (prev as HTMLElement)
            : null; // BR nodes tend to only return the rectangle before them
      if (target) {
        let rect = singleRect(target, 1);
        if (rect.top < rect.bottom) return flattenV(rect, false);
      }
    } else if (dir > 0 && offset < nodeSize(node)) {
      let next: Node,
        target =
          node.nodeType == Node.TEXT_NODE
            ? textRange(node, offset, offset + 1)
            : (next = node.childNodes[offset]).nodeType == 3
            ? textRange(next)
            : next.nodeType == Node.ELEMENT_NODE
            ? (next as HTMLElement)
            : null;
      if (target) {
        let rect = singleRect(target, -1);
        if (rect.top < rect.bottom) return flattenV(rect, true);
      }
    }
  }
  // All else failed, just try to get a rectangle for the target node
  return flattenV(singleRect(node.nodeType == Node.TEXT_NODE ? textRange(node) : (node as HTMLElement), 0), false);
}

function flattenV(rect: DOMRect, left: boolean) {
  if (rect.width == 0) return rect;
  let x = left ? rect.left : rect.right;
  return { top: rect.top, bottom: rect.bottom, left: x, right: x };
}

function flattenH(rect: DOMRect, top: boolean) {
  if (rect.height == 0) return rect;
  let y = top ? rect.top : rect.bottom;
  return { top: y, bottom: y, left: rect.left, right: rect.right };
}

function withFlushedState(view: EditorView, state: EditorState, f: () => any) {
  let viewState = view.state,
    active = (view.root as Document).activeElement as HTMLElement;
  if (viewState != state) view.updateState(state);
  if (active != view.dom) view.focus();
  try {
    return f();
  } finally {
    if (viewState != state) view.updateState(viewState);
    if (active != view.dom && active) active.focus();
  }
}

// : (EditorView, number, number)
// Whether vertical position motion in a given direction
// from a position would leave a text block.
function endOfTextblockVertical(view: EditorView, state: EditorState, dir: string) {
  let sel = state.selection;
  let $pos = dir == "up" ? sel.$anchor.min(sel.$head) : sel.$anchor.max(sel.$head);
  return withFlushedState(view, state, () => {
    let { node: dom } = view.docView.domFromPos($pos.pos);
    for (;;) {
      let nearest = view.docView.nearestDesc(dom, true);
      if (!nearest) break;
      if (nearest.node.isBlock) {
        dom = nearest.dom;
        break;
      }
      dom = nearest.dom.parentNode;
    }
    let coords = coordsAtPos(view, $pos.pos);
    for (let child = dom.firstChild; child; child = child.nextSibling) {
      let boxes: any;
      if (child.nodeType == Node.ELEMENT_NODE) boxes = (child as Element).getClientRects();
      else if (child.nodeType == Node.TEXT_NODE) boxes = textRange(child, 0, child.nodeValue.length).getClientRects();
      else continue;
      for (let i = 0; i < boxes.length; i++) {
        let box = boxes[i];
        if (box.bottom > box.top && (dir == "up" ? box.bottom < coords.top + 1 : box.top > coords.bottom - 1))
          return false;
      }
    }
    return true;
  });
}

const maybeRTL = /[\u0590-\u08ac]/;

function endOfTextblockHorizontal(view: EditorView, state: EditorState, dir: IDir) {
  let { $head } = state.selection;
  if (!$head.parent.isTextblock) return false;
  let offset = $head.parentOffset,
    atStart = !offset,
    atEnd = offset == $head.parent.content.size;
  let sel = getSelection();
  // If the textblock is all LTR, or the browser doesn't support
  // Selection.modify (Edge), fall back to a primitive approach
  if (!maybeRTL.test($head.parent.textContent) || !(sel as any).modify)
    return dir == "left" || dir == "backward" ? atStart : atEnd;

  return withFlushedState(view, state, () => {
    // This is a huge hack, but appears to be the best we can
    // currently do: use `Selection.modify` to move the selection by
    // one character, and see if that moves the cursor out of the
    // textblock (or doesn't move it at all, when at the start/end of
    // the document).
    let oldRange = sel.getRangeAt(0),
      oldNode = sel.focusNode,
      oldOff = sel.focusOffset;
    let oldBidiLevel = (sel as any).caretBidiLevel; // Only for Firefox
    (sel as any).modify("move", dir, "character");
    let parentDOM = $head.depth ? view.docView.domAfterPos($head.before()) : view.dom;
    let result =
      !parentDOM.contains(sel.focusNode.nodeType == 1 ? sel.focusNode : sel.focusNode.parentNode) ||
      (oldNode == sel.focusNode && oldOff == sel.focusOffset);
    // Restore the previous selection
    sel.removeAllRanges();
    sel.addRange(oldRange);
    if (oldBidiLevel != null) (sel as any).caretBidiLevel = oldBidiLevel;
    return result;
  });
}

let cachedState = null,
  cachedDir = null,
  cachedResult = false;
export function endOfTextblock(view: EditorView, state: EditorState, dir: IDir) {
  if (cachedState == state && cachedDir == dir) return cachedResult;
  cachedState = state;
  cachedDir = dir;
  return (cachedResult =
    dir == "up" || dir == "down"
      ? endOfTextblockVertical(view, state, dir)
      : endOfTextblockHorizontal(view, state, dir));
}
