/* Copyright 2016 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { NullL10n } from './ui_utils';
import { RenderingStates } from './pdf_rendering_queue';

const UI_NOTIFICATION_CLASS = 'pdfSidebarNotification';

const SidebarView = {
  UNKNOWN: -1,
  NONE: 0,
  THUMBS: 1, // Default value.
  OUTLINE: 2,
  ATTACHMENTS: 3,
  LAYERS: 4
};

/**
 * @typedef {Object} PDFSidebarOptions
 * @property {PDFSidebarElements} elements - The DOM elements.
 * @property {PDFViewer} pdfViewer - The document viewer.
 * @property {PDFThumbnailViewer} pdfThumbnailViewer - The thumbnail viewer.
 * @property {EventBus} eventBus - The application event bus.
 * @property {IL10n} l10n - The localization service.
 * @property {boolean} [disableNotification] - Disable the notification for
 *   documents containing outline/attachments. The default value is `false`.
 */

/**
 * @typedef {Object} PDFSidebarElements
 * @property {HTMLDivElement} outerContainer - The outer container
 *   (encasing both the viewer and sidebar elements).
 * @property {HTMLDivElement} viewerContainer - The viewer container
 *   (in which the viewer element is placed).
 * @property {HTMLButtonElement} toggleButton - The button used for
 *   opening/closing the sidebar.
 * @property {HTMLButtonElement} thumbnailButton - The button used to show
 *   the thumbnail view.
 * @property {HTMLButtonElement} outlineButton - The button used to show
 *   the outline view.
 * @property {HTMLButtonElement} attachmentsButton - The button used to show
 *   the attachments view.
 * @property {HTMLDivElement} thumbnailView - The container in which
 *   the thumbnails are placed.
 * @property {HTMLDivElement} outlineView - The container in which
 *   the outline is placed.
 * @property {HTMLDivElement} attachmentsView - The container in which
 *   the attachments are placed.
 */

class PDFSidebar {
  /**
   * @param {PDFSidebarOptions} options
   */
  constructor({ elements, pdfViewer, pdfThumbnailViewer, eventBus,
                l10n = NullL10n, disableNotification = false, }) {
    this.isOpen = false;
    this.active = SidebarView.THUMBS;
    this.default = SidebarView.THUMBS;
    this.isInitialViewSet = false;

    /**
     * Callback used when the sidebar has been opened/closed, to ensure that
     * the viewers (PDFViewer/PDFThumbnailViewer) are updated correctly.
     */
    this.onToggled = null;

    this.pdfViewer = pdfViewer;
    this.pdfThumbnailViewer = pdfThumbnailViewer;

    this.outerContainer = elements.outerContainer;
    this.viewerContainer = elements.viewerContainer;
    this.toggleButton = elements.toggleButton;
    this.toolbar = elements.toolbar;
    this.content = elements.content;

    this.thumbnailButton = elements.thumbnailButton;
    this.outlineButton = elements.outlineButton;
    this.attachmentsButton = elements.attachmentsButton;

    this.thumbnailView = elements.thumbnailView;
    this.outlineView = elements.outlineView;
    this.attachmentsView = elements.attachmentsView;

    this.eventBus = eventBus;
    this.l10n = l10n;
    this._disableNotification = disableNotification;

    this.panels = {};
    this.panels[SidebarView.THUMBS] = { button: this.thumbnailButton, 
      view: this.thumbnailView, };
    this.panels[SidebarView.OUTLINE] = { button: this.outlineButton, 
      view: this.outlineView, };
    this.panels[SidebarView.ATTACHMENTS] = { button: this.attachmentButton, 
      view: this.attachmentView, };

    this._addEventListeners();
  }

  reset() {
    this.isInitialViewSet = false;

    this._hideUINotification(null);
    this.switchView(this.default);

    this.outlineButton.disabled = false;
    this.attachmentsButton.disabled = false;
  }

  /**
   * @type {number} One of the values in {SidebarView}.
   */
  get visibleView() {
    return (this.isOpen ? this.active : SidebarView.NONE);
  }

  get isThumbnailViewVisible() {
    return (this.isOpen && this.active === SidebarView.THUMBS);
  }

  get isOutlineViewVisible() {
    return (this.isOpen && this.active === SidebarView.OUTLINE);
  }

  get isAttachmentsViewVisible() {
    return (this.isOpen && this.active === SidebarView.ATTACHMENTS);
  }

  /**
   * @param {number} view - The sidebar view that should become visible,
   *                        must be one of the values in {SidebarView}.
   */
  setInitialView(view = SidebarView.NONE) {
    if (this.isInitialViewSet) {
      return;
    }
    this.isInitialViewSet = true;

    // If the user has already manually opened the sidebar, immediately closing
    // it would be bad UX; also ignore the "unknown" sidebar view value.
    if (view === SidebarView.NONE || view === SidebarView.UNKNOWN) {
      this._dispatchEvent();
      return;
    }
    // Prevent dispatching two back-to-back `sidebarviewchanged` events,
    // since `this._switchView` dispatched the event if the view changed.
    if (!this._switchView(view, /* forceOpen */ true)) {
      this._dispatchEvent();
    }
  }

  addPanel(parameters) {

    let button = document.createElement('button');

    let className = 'toolbarButton';
    if (parameters.extraClass !== undefined) {
      className += ' ' + parameters.extraClass;
    }
    button.className = className;
    button.id = 'view' + parameters.id;
    button.setAttribute('title', parameters.title);
    button.setAttribute('tabindex', this.toolbar.childElementCount + 2);

    let label = document.createElement('span');
    label.textContent = parameters.label;
    button.appendChild(label);

    this.toolbar.appendChild(button);
    button.addEventListener('click', () => {
      this.switchView(parameters.idx);
    });

    let view = document.createElement('div');
    className = 'hidden';
    if (parameters.extraClass !== undefined) {
      className += ' ' + parameters.extraClass;
    }
    view.className = className;
    view.id = parameters.id;
    this.content.appendChild(view);

    if (typeof parameters.content === 'function') {
      view.appendChild(parameters.content());
    } else {
      view.appendChild(parameters.content);
    }

    this.panels[parameters.idx] = { button, view, };

  }

  /**
   * @param {number} view - The sidebar view that should be switched to,
   *                        must be one of the values in {SidebarView}.
   * @param {boolean} [forceOpen] - Ensure that the sidebar is open.
   *                                The default value is `false`.
   */
  switchView(view, forceOpen = false) {
    this._switchView(view, forceOpen);
  }

  /**
   * @returns {boolean} Indicating if `this._dispatchEvent` was called.
   * @private
   */
  _switchView(view, forceOpen = false) {
    const isViewChanged = (view !== this.active);
    let shouldForceRendering = false;

    const target = this.panels[view];
    if (target === undefined) {
      console.error(`PDFSidebar._switchView: "${view}" is not a valid view.`);
      return false;
    }

    if (target.button.disabled) {
      return false;
    }

    switch (view) {
      case SidebarView.NONE:
        if (this.isOpen) {
          this.close();
          return true; // Closing will trigger rendering and dispatch the event.
        }
        return false;
      case SidebarView.THUMBS:
        if (this.isOpen && isViewChanged) {
          shouldForceRendering = true;
        }
        break;
    }
    // Update the active view *after* it has been validated above,
    // in order to prevent setting it to an invalid state.
    this.active = view;

    // Update the CSS classes, for all buttons...
    for (let key in this.panels) {
      if (this.panels.hasOwnProperty(key)) {
        let panel = this.panels[key];

        if (panel.button !== undefined) {
          panel.button.classList.toggle('toggled', view === Number(key));
        }
        if (panel.view !== undefined) {
         panel.view.classList.toggle('hidden', view !== Number(key));
        }
      }
    }

    if (forceOpen && !this.isOpen) {
      this.open();
      return true; // Opening will trigger rendering and dispatch the event.
    }
    if (shouldForceRendering) {
      this._updateThumbnailViewer();
      this._forceRendering();
    }
    if (isViewChanged) {
      this._dispatchEvent();
    }
    this._hideUINotification(this.active);
    return isViewChanged;
  }

  open() {
    if (this.isOpen) {
      return;
    }
    this.isOpen = true;
    this.toggleButton.classList.add('toggled');

    this.outerContainer.classList.add('sidebarMoving', 'sidebarOpen');

    if (this.active === SidebarView.THUMBS) {
      this._updateThumbnailViewer();
    }
    this._forceRendering();
    this._dispatchEvent();

    this._hideUINotification(this.active);
  }

  close() {
    if (!this.isOpen) {
      return;
    }
    this.isOpen = false;
    this.toggleButton.classList.remove('toggled');

    this.outerContainer.classList.add('sidebarMoving');
    this.outerContainer.classList.remove('sidebarOpen');

    this._forceRendering();
    this._dispatchEvent();
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * @private
   */
  _dispatchEvent() {
    this.eventBus.dispatch('sidebarviewchanged', {
      source: this,
      view: this.visibleView,
    });
  }

  /**
   * @private
   */
  _forceRendering() {
    if (this.onToggled) {
      this.onToggled();
    } else { // Fallback
      this.pdfViewer.forceRendering();
      this.pdfThumbnailViewer.forceRendering();
    }
  }

  /**
   * @private
   */
  _updateThumbnailViewer() {
    let { pdfViewer, pdfThumbnailViewer, } = this;

    // Use the rendered pages to set the corresponding thumbnail images.
    let pagesCount = pdfViewer.pagesCount;
    for (let pageIndex = 0; pageIndex < pagesCount; pageIndex++) {
      let pageView = pdfViewer.getPageView(pageIndex);
      if (pageView && pageView.renderingState === RenderingStates.FINISHED) {
        let thumbnailView = pdfThumbnailViewer.getThumbnail(pageIndex);
        thumbnailView.setImage(pageView);
      }
    }
    pdfThumbnailViewer.scrollThumbnailIntoView(pdfViewer.currentPageNumber);
  }

  /**
   * @private
   */
  _showUINotification(view) {
    if (this._disableNotification) {
      return;
    }

    this.l10n.get('toggle_sidebar_notification.title', null,
                  'Toggle Sidebar (document contains outline/attachments)').
        then((msg) => {
      this.toggleButton.title = msg;
    });

    if (!this.isOpen) {
      // Only show the notification on the `toggleButton` if the sidebar is
      // currently closed, to avoid unnecessarily bothering the user.
      this.toggleButton.classList.add(UI_NOTIFICATION_CLASS);
    } else if (view === this.active) {
      // If the sidebar is currently open *and* the `view` is visible, do not
      // bother the user with a notification on the corresponding button.
      return;
    }

    let panel = this.panels[view];
    if (panel.button !== undefined) {
      panel.button.classList.add(UI_NOTIFICATION_CLASS);
    }
  }

  /**
   * @private
   */
  _hideUINotification(view) {
    if (this._disableNotification) {
      return;
    }

    let removeNotification = (view) => {
      let panel = this.panels[view];
      if (panel !== undefined && panel.button !== undefined) {
        panel.button.classList.remove(UI_NOTIFICATION_CLASS);
      }
    };

    if (!this.isOpen && view !== null) {
      // Only hide the notifications when the sidebar is currently open,
      // or when it is being reset (i.e. `view === null`).
      return;
    }
    this.toggleButton.classList.remove(UI_NOTIFICATION_CLASS);

    if (view !== null) {
      removeNotification(view);
      return;
    }
    for (view in SidebarView) { // Remove all sidebar notifications on reset.
      removeNotification(SidebarView[view]);
    }

    this.l10n.get('toggle_sidebar.title', null, 'Toggle Sidebar').
        then((msg) => {
      this.toggleButton.title = msg;
    });
  }

  /**
   * @private
   */
  _addEventListeners() {
    this.viewerContainer.addEventListener('transitionend', (evt) => {
      if (evt.target === this.viewerContainer) {
        this.outerContainer.classList.remove('sidebarMoving');
      }
    });

    this.toggleButton.addEventListener('click', () => {
      this.toggle();
    });

    // Buttons for switching views.
    for (let key in this.panels) {
      if (this.panels.hasOwnProperty(key)) {
        let panel = this.panels[key];
        if (panel.button !== undefined) {
          panel.button.addEventListener('click', () => {
            this.switchView(Number(key));
          });
        }
      }
    }
  
    // Disable/enable views.
    this.eventBus.on('outlineloaded', (evt) => {
      let outlineCount = evt.outlineCount;

      this.outlineButton.disabled = !outlineCount;

      if (outlineCount) {
        this._showUINotification(SidebarView.OUTLINE);
      } else if (this.active === SidebarView.OUTLINE) {
        // If the outline view was opened during document load, switch away
        // from it if it turns out that the document has no outline.
        this.switchView(SidebarView.THUMBS);
      }
    });

    this.eventBus.on('attachmentsloaded', (evt) => {
      if (evt.attachmentsCount) {
        this.attachmentsButton.disabled = false;

        this._showUINotification(SidebarView.ATTACHMENTS);
        return;
      }

      // Attempt to avoid temporarily disabling, and switching away from, the
      // attachment view for documents that do not contain proper attachments
      // but *only* FileAttachment annotations. Hence we defer those operations
      // slightly to allow time for parsing any FileAttachment annotations that
      // may be present on the *initially* rendered page of the document.
      Promise.resolve().then(() => {
        if (this.attachmentsView.hasChildNodes()) {
          // FileAttachment annotations were appended to the attachment view.
          return;
        }
        this.attachmentsButton.disabled = true;

        if (this.active === SidebarView.ATTACHMENTS) {
          // If the attachment view was opened during document load, switch away
          // from it if it turns out that the document has no attachments.
          this.switchView(SidebarView.THUMBS);
        }
      });
    });

    // Update the thumbnailViewer, if visible, when exiting presentation mode.
    this.eventBus.on('presentationmodechanged', (evt) => {
      if (!evt.active && !evt.switchInProgress && this.isThumbnailViewVisible) {
        this._updateThumbnailViewer();
      }
    });
  }
}

export {
  SidebarView,
  PDFSidebar,
};
