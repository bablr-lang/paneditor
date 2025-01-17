/* global window */

import emptyStack from '@iter-tools/imm-stack';
import joinWith from 'iter-tools-es/methods/join-with';
import find from 'iter-tools-es/methods/find';
import { createEffect, useContext } from 'solid-js';
import { streamParse } from 'bablr';
import * as language from '@bablr/language-en-json';
import classNames from 'classnames';
import {
  SelectionContext,
  BABLRContext,
  StoreContext,
  SumContext,
  nodeBindings,
} from '../../state/store.js';
import { printReferenceTag, streamFromTree, traverseProperties } from '@bablr/agast-helpers/tree';
import * as btree from '@bablr/agast-helpers/btree';
import {
  ReferenceTag,
  OpenNodeTag,
  CloseNodeTag,
  OpenFragmentTag,
  CloseFragmentTag,
  LiteralTag,
  NullTag,
  ArrayTag,
  GapTag,
  node,
} from '@bablr/agast-helpers/symbols';
import { buildFullyQualifiedSpamMatcher } from '@bablr/agast-vm-helpers/builders';

import './Editor.css';

function* ancestors(node) {
  let parent = node;
  while (parent && nodeBindings.has(parent)) {
    yield parent;
    parent = parent.parentNode;
  }
}

const computeStartPos = (node, widths) => {};

const buildChangeTemplate = (agastContext, rootPathNode) => {
  let expressions = [];

  for (const pathNode of [...ancestors(rootPathNode)].reverse()) {
    let node = nodeBindings.get(pathNode);

    debugger;
  }

  return { source: streamFromTree(node), expressions };
};

const get = (node, path) => {
  const { 1: name, 2: index } = /^([^\.]+)(?:\.(\d+))?/.exec(path) || [];

  if (index != null) {
    return btree.getAt(parseInt(index, 10), node.properties[name]);
  } else {
    return node.properties[name];
  }
};

export const getWidth = (node) => {
  if (node.type === Symbol.for('@bablr/gap')) return 1;
  if (node.type === Symbol.for('@bablr/null')) return 0;

  return node.flags.token
    ? [...btree.traverse(node.children)].reduce((w, tag) => {
        switch (tag.type) {
          case LiteralTag:
            return w + tag.value.length;
          case ReferenceTag:
            throw new Error('unimplemented');
          default:
            return w;
        }
      }, 0)
    : reduceNode(
        node,
        (sum, node) => {
          return sum + getWidth(node);
        },
        0,
      );
};

const reduceNode = (node, reducer, initialValue) => {
  let acc = initialValue;
  for (const childNode of traverseProperties(node.properties)) {
    acc = reducer(acc, childNode);
  }
  return acc;
};

function Editor() {
  const { selectionRoot, selectedRange, setSelectedRange } = useContext(SelectionContext);
  const { store, setStore } = useContext(StoreContext);
  const { widths } = useContext(SumContext);
  const bablrContext = useContext(BABLRContext);
  const agastContext = bablrContext.agast;

  createEffect(() => {
    if (!store.editing) {
      window.getSelection().removeAllRanges();
    }
  });

  const matcher = buildFullyQualifiedSpamMatcher(
    { hasGap: true },
    language.canonicalURL,
    'Expression',
  );

  const madness = () => {
    const tags_ = [
      ...streamParse(
        bablrContext,
        matcher,
        store.document.source,
        {},
        { agastContext, expressions: store.document.expressions },
      ),
    ];

    const tags = [...tags_];

    return tags.reduce((stack, tag) => {
      if (tag.type === ReferenceTag) {
        stack = stack.push({ type: null, node: null, fragment: null });
      }

      if (tag.type === OpenFragmentTag) {
        const node = agastContext.nodeForTag(tag);

        const newFrame = {
          type: null,
          node,
          fragment: <></>,
        };

        stack = stack.push(newFrame);
      }

      if (tag.type === OpenNodeTag) {
        let ref = agastContext.getPreviousTag(tag);
        const node = agastContext.nodeForTag(tag);
        const { type, flags } = tag.value;

        while (ref && ref.type !== ReferenceTag) {
          ref = agastContext.getPreviousTag(ref);
        }

        const newFrame = {
          type,
          node,
          fragment: <></>,
        };

        if (type && !(flags.escape || flags.trivia)) {
          stack = stack.replace(newFrame);
        } else {
          stack = stack.push(newFrame);
        }
      }

      if (tag.type === LiteralTag) {
        const { value } = tag;
        stack = stack.replace({
          node: stack.value.node,
          type: stack.value.type,
          fragment: (
            <>
              {stack.value.fragment}
              {[...joinWith(<br />, value.replace(/ /g, '\u00a0').split('\n'))]}
            </>
          ),
        });
      }

      if (tag.type === NullTag || tag.type === ArrayTag) {
        stack = stack.pop();
      }

      if (tag.type === GapTag) {
        const ownNode = agastContext.nodeForTag(tag);
        const span = (
          <span class={classNames({ gap: true, selected: selectionRoot() === ownNode })}>
            &nbsp;
          </span>
        );

        nodeBindings.set(ownNode, span);
        nodeBindings.set(span, ownNode);
        widths.set(ownNode, 1);

        stack = stack.pop();

        stack.value.fragment = (
          <>
            {stack.value.fragment}
            {span}
          </>
        );
      }

      if (tag.type === CloseNodeTag) {
        const doneFrame = stack.value;
        let type, node, fragment;

        stack = stack.pop();

        const { flags } = doneFrame.node;

        const reference = agastContext.getPreviousTag(btree.getAt(0, doneFrame.node.children));

        const referenceAttributes = !(flags.trivia || flags.escape)
          ? {
              'data-type': doneFrame.node?.type.description,
              'data-path': printReferenceTag(reference).slice(0, -1),
            }
          : {};

        const selected = () => {
          return selectionRoot() === doneFrame.node;
        };

        const contentEditable = () =>
          selected() && store.editing && flags.token ? { contenteditable: true } : {};

        const draggable = () =>
          selected() && store.selectionState === 'selected' ? { draggable: true } : {};

        const dragging = () => selected() && !!store.dragTarget;

        const span = (
          <span
            {...referenceAttributes}
            {...contentEditable()}
            {...draggable()}
            class={classNames({
              escape: flags.escape,
              token: flags.token,
              trivia: flags.trivia,
              hasGap: flags.hasGap,
              selected: selected(),
              dragging: dragging(),
            })}
          >
            {doneFrame.fragment}
          </span>
        );

        nodeBindings.set(doneFrame.node, span);
        nodeBindings.set(span, doneFrame.node);
        widths.set(doneFrame.node, getWidth(doneFrame.node));

        node = stack.value.node;
        type = stack.value.type;
        fragment = span;

        stack = stack.replace({
          type,
          node,
          fragment: (
            <>
              {stack.value.fragment}
              {fragment}
            </>
          ),
        });
      }

      if (tag.type === CloseFragmentTag) {
        const doneFrame = stack.value;
        let { fragment } = doneFrame;

        stack = stack.pop();

        // capture the return value (an empty stack doesn't hold any data)

        stack = stack.replace({
          type: null,
          node: stack.value.node,
          fragment: (
            <>
              {stack.value.fragment}
              {fragment}
            </>
          ),
        });
      }

      return stack;
    }, emptyStack.push({ type: null, node: null, fragment: null }));
  };

  return (
    <>
      <div
        class="editor"
        onMouseDown={(e) => {
          const tokenNode = nodeBindings.get(e.target);

          const oldDoubleClickTarget = store.doubleClickTarget;

          if (!oldDoubleClickTarget) {
            setStore('doubleClickTarget', e.target);

            window.setTimeout(() => setStore('doubleClickTarget', null), 300);
          } else {
            setStore('doubleClickTarget', null);
          }

          // if (store.selectionState === 'selected') debugger;
          if (
            store.selectionState === 'selected' &&
            find((node) => node.draggable, ancestors(e.target)) &&
            !oldDoubleClickTarget
          ) {
            return;
          }

          if ((oldDoubleClickTarget || !tokenNode) && !store.editing) {
            e.preventDefault();
          }

          if (tokenNode) {
            setSelectedRange([tokenNode, tokenNode]);
          } else {
            setSelectedRange([null, null]);
          }
          setStore('selectionState', 'selecting');

          const selection = window.getSelection();

          const isEditModeClick =
            store.editing &&
            e.target.contentEditable &&
            e.target === selection?.focusNode?.parentElement;

          if (!isEditModeClick) {
            if (store.editing) {
              setStore('editing', false);
            }

            if (oldDoubleClickTarget && e.target === oldDoubleClickTarget) {
              const range = store.doubleClickRange;

              setStore('editing', true);
              setStore('doubleClickRange', null);

              selection.removeAllRanges();
              selection.addRange(range);

              e.preventDefault();
            } else {
              window.setTimeout(() => {
                if (store.doubleClickTarget) {
                  const range = selection.rangeCount ? selection.getRangeAt(0) : null;
                  selection.removeAllRanges();
                  if (range) range.collapse();
                  setStore('doubleClickRange', range);
                }
              });
            }
          }
        }}
        onMouseOver={(e) => {
          if (store.selectionState === 'selecting') {
            const tokenNode = nodeBindings.get(e.target);
            const selected = selectedRange();

            if (tokenNode?.type === Symbol.for('@bablr/gap')) {
              const startTokenNode = selected[0];
              setSelectedRange([startTokenNode, tokenNode]);
            } else if (tokenNode) {
              let range;

              const startTokenNode = selected[0];

              if (startTokenNode) {
                if (computeStartPos(tokenNode, widths) < computeStartPos(startTokenNode, widths)) {
                  range = [startTokenNode, tokenNode];
                } else {
                  range = [startTokenNode, tokenNode];
                }
              } else {
                range = [tokenNode, tokenNode];
              }

              setSelectedRange(range);
            } else {
              setSelectedRange([selectedRange()[0], selectedRange()[0]]);
            }
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setStore('editing', false);
          }

          e.preventDefault();
        }}
        onMouseOut={(e) => {
          if (store.selectionState === 'selecting') {
            const token = nodeBindings.get(e.target);
            if (!token) {
              setSelectedRange([selectedRange()[0], selectedRange()[0]]);
            }
          }
        }}
        onMouseUp={(e) => {
          setStore('selectionState', selectedRange() ? 'selected' : 'none');

          if (e.target !== store.doubleClickTarget) {
            setStore('doubleClickTarget', null);
          }
        }}
        onDragStart={(e) => {
          const clone = e.target.cloneNode(true);
          clone.id = 'dragShadow';
          window.document.body.appendChild(clone);
          e.dataTransfer.setDragImage(clone, 0, 0);
          setStore('dragTarget', e.target);
        }}
        onDragOver={(e) => {
          const tokenNode = nodeBindings.get(e.target);

          if (tokenNode?.type === Symbol.for('@bablr/gap')) {
            e.dataTransfer.dropEffect = 'move';
            e.preventDefault(); // allow drop
          }
        }}
        onDragEnd={(e) => {
          setStore('dragTarget', null);

          setStore('doubleClickTarget', null);

          window.document.getElementById('dragShadow').remove();
        }}
        onDrop={(e) => {
          const tokenNode = nodeBindings.get(e.target);

          e.preventDefault();

          if (tokenNode?.type === Symbol.for('@bablr/gap')) {
            const { dragTarget } = store;

            setStore('document', buildChangeTemplate(agastContext, e.target));

            dragTarget.parentNode.removeChild(dragTarget);

            e.target.replaceWith(dragTarget);
          }
        }}
      >
        {madness().value.fragment}
      </div>
    </>
  );
}

export default Editor;
