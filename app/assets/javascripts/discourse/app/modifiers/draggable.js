import Modifier from "ember-modifier";
import { registerDestructor } from "@ember/destroyable";
import { bind } from "discourse-common/utils/decorators";

export default class DraggableModifier extends Modifier {
  hasStarted = false;
  element;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, (instance) => instance.cleanup());
  }

  modify(el, _, { didStartDrag, didEndDrag, dragMove }) {
    this.element = el;
    this.didStartDragCallback = didStartDrag;
    this.didEndDragCallback = didEndDrag;
    this.dragMoveCallback = dragMove;
    this.element.addEventListener("touchstart", this.dragMove, {
      passive: false,
    });
    this.element.addEventListener("mousedown", this.dragMove, {
      passive: false,
    });
  }

  @bind
  dragMove(e) {
    e.stopPropagation();
    e.preventDefault();
    if (!this.hasStarted) {
      this.hasStarted = true;

      if (this.didStartDragCallback) {
        this.didStartDragCallback(e);
      }

      // Register a global event to capture mouse moves when element 'clicked'.
      document.addEventListener("touchmove", this.drag, { passive: false });
      document.addEventListener("mousemove", this.drag, { passive: false });
      document.body.classList.add("dragging");

      // On leaving click, stop moving.
      document.addEventListener("touchend", this.didEndDrag, {
        passive: false,
      });
      document.addEventListener("mouseup", this.didEndDrag, {
        passive: false,
      });
    }
  }

  @bind
  drag(e) {
    if (this.hasStarted && this.dragMoveCallback) {
      this.dragMoveCallback(e, this.element);
    }
  }

  @bind
  didEndDrag(e) {
    if (this.hasStarted) {
      this.didEndDragCallback(e, this.element);

      document.removeEventListener("touchmove", this.drag);
      document.removeEventListener("mousemove", this.drag);

      document.body.classList.remove("dragging");
      this.hasStarted = false;
    }
  }

  cleanup() {
    document.removeEventListener("touchstart", this.dragMove);
    document.removeEventListener("mousedown", this.dragMove);
    document.removeEventListener("touchend", this.didEndDrag);
    document.removeEventListener("mouseup", this.didEndDrag);
    document.removeEventListener("mousemove", this.drag);
    document.removeEventListener("touchmove", this.drag);
    document.body.classList.remove("dragging");
  }
}
