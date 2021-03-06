import browser from "./browser";
import { ViewDesc } from "./viewdesc";

export const domIndex = function (node: Node) {
  for (var index = 0; ; index++) {
    node = node.previousSibling;
    if (!node) return index;
  }
};

export const parentNode = function (node: Node) {
  let parent = node.parentNode;
  return parent && parent.nodeType == Node.DOCUMENT_FRAGMENT_NODE ? (parent as any).host : parent;
};

export const textRange = function (node: Node, from?: number, to?: number) {
  let range = document.createRange();
  range.setEnd(node, to == null ? node.nodeValue.length : to);
  range.setStart(node, from || 0);
  return range;
};

// Scans forward and backward through DOM positions equivalent to the
// given one to see if the two are in the same place (i.e. after a
// text node vs at the end of that text node)
export const isEquivalentPosition = function (node: Node, off: number, targetNode: Node, targetOff: number) {
  return targetNode && (scanFor(node, off, targetNode, targetOff, -1) || scanFor(node, off, targetNode, targetOff, 1));
};

const atomElements = /^(img|br|input|textarea|hr)$/i;

function scanFor(node: Node, off: number, targetNode: Node, targetOff: number, dir: number) {
  for (;;) {
    if (node == targetNode && off == targetOff) return true;
    if (off == (dir < 0 ? 0 : nodeSize(node))) {
      let parent = node.parentNode;
      // XXX 修改过，原来是 1
      if (
        parent.nodeType != Node.ELEMENT_NODE ||
        hasBlockDesc(node) ||
        atomElements.test(node.nodeName) ||
        (node as HTMLElement).contentEditable == "false"
      )
        return false;
      off = domIndex(node) + (dir < 0 ? 0 : 1);
      node = parent;
    } else if (node.nodeType == 1) {
      node = node.childNodes[off + (dir < 0 ? -1 : 0)];
      if ((node as HTMLElement).contentEditable == "false") return false;
      off = dir < 0 ? nodeSize(node) : 0;
    } else {
      return false;
    }
  }
}

export function nodeSize(node: Node) {
  return node.nodeType == 3 ? node.nodeValue.length : node.childNodes.length;
}

export function isOnEdge(node: Node, offset: number, parent: Node) {
  for (let atStart = offset == 0, atEnd = offset == nodeSize(node); atStart || atEnd; ) {
    if (node == parent) return true;
    let index = domIndex(node);
    node = node.parentNode;
    if (!node) return false;
    atStart = atStart && index == 0;
    atEnd = atEnd && index == nodeSize(node);
  }
}

function hasBlockDesc(dom: Node) {
  let desc: ViewDesc;
  for (let cur = dom; cur; cur = cur.parentNode) if ((desc = cur.pmViewDesc)) break;
  return desc && desc.node && desc.node.isBlock && (desc.dom == dom || desc.contentDOM == dom);
}

// Work around Chrome issue https://bugs.chromium.org/p/chromium/issues/detail?id=447523
// (isCollapsed inappropriately returns true in shadow dom)
export const selectionCollapsed = function (domSel: Selection) {
  let collapsed = domSel.isCollapsed;
  if (collapsed && browser.chrome && domSel.rangeCount && !domSel.getRangeAt(0).collapsed) collapsed = false;
  return collapsed;
};

export function keyEvent(keyCode: number, key: string) {
  let event = document.createEvent("Event") as Event & {
    keyCode: number;
    code: string;
    key: string;
  };
  event.initEvent("keydown", true, true);
  event.keyCode = keyCode;
  event.key = event.code = key;
  return event;
}
