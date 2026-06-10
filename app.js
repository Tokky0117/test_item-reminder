// ========================================
// 基本設定
// ========================================
const APP_VERSION = "3.1.1";
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzVXg3onyOQzhidikArLr1gRc0L1Px3oNK5fQs6VqNA3XoxLJ_y4I35GEmofCB2g7Cn7g/exec";


const REFRESH_OFFSET = 56;
const PULL_TRIGGER_DISTANCE = 72;
const PULL_MAX_DISTANCE = 96;

const SWIPE_ACTION_WIDTH = 124;
const SWIPE_OPEN_THRESHOLD = 32;
const SWIPE_CLOSE_THRESHOLD = 24;
const BUTTON_TAP_MOVE_CANCEL_DISTANCE = 12;
const SPARE_SAVE_DEBOUNCE_MS = 800;
const SAVE_TIMEOUT_MS = 15000;

const CLIENT_ID_STORAGE_KEY = "dailyReminderClientId";

function getClientId() {
  try {
    let clientId = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (!clientId) {
      clientId = "c_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
    }
    return clientId;
  } catch (error) {
    return "c_session_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }
}

function createRequestId() {
  return "r_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 12);
}

function createSaveRequest(mutation) {
  return {
    mutation: mutation || null,
    clientId: getClientId(),
    requestId: createRequestId()
  };
}

function ensureSaveRequest(request) {
  const source = request || {};
  return {
    mutation: source.mutation || null,
    clientId: source.clientId || getClientId(),
    requestId: source.requestId || createRequestId()
  };
}

function cloneSaveRequest(request) {
  return ensureSaveRequest(request);
}

function clonePendingRequests(requests) {
  return (requests || []).filter(Boolean).map(request => cloneSaveRequest(request));
}

const REORDER_HOLD_MS = 520;
const COPY_FEEDBACK_MS = 1400;
const REORDER_CANCEL_MOVE = 8;
const REORDER_STEP_DISTANCE = 44;
const REORDER_AUTO_SCROLL_ZONE = 64;
const REORDER_AUTO_SCROLL_MAX_SPEED = 9;
const ORDER_STEP = 1;

const OWNER_TABS = [
  { key: "共", full: "共同" },
  { key: "み", full: "みゆう" },
  { key: "か", full: "かずまさ" },
  { key: "all", full: "すべて" }
];

const OWNER_OPTIONS = [
  { key: "共", name: "共同" },
  { key: "み", name: "みゆう" },
  { key: "か", name: "かずまさ" }
];

const CATEGORY_LABELS = [
  { key: "food", name: "飲食" },
  { key: "kitchen", name: "キッチン" },
  { key: "bath", name: "洗面・お風呂" },
  { key: "cleaning", name: "洗濯・掃除" },
  { key: "other", name: "その他" }
];

// ========================================
// 状態管理
// ========================================
let items = [];
let toastTimer = null;
let startupToastTimer = null;
let copyButtonFeedbackTimer = null;
let itemModalCloseTimer = null;
let reorderHoldTimer = null;

let shoppingMode = false;
let shoppingModeItemIds = new Set();
let activeOwnerTab = "all";
let collapsedCategories = new Set();

let pendingFocusItemId = null;
let highlightedItemId = null;
let highlightTimer = null;
let recentlyToggledItemId = null;
let recentlyToggledTimer = null;

let modalMode = "add";
let editingItemId = null;
let deletingItemId = null;
let swipedItemId = null;

let swipeItemId = null;
let swipeStartX = 0;
let swipeStartY = 0;
let swipeCurrentX = 0;
let swipeCurrentY = 0;
let swipeBaseOffset = 0;
let swipeMoved = false;
let swipeCanceled = false;
let swipeDirection = null;
let swipeFrameElement = null;
let swipeItemElement = null;

let isReordering = false;
let reorderItemId = null;
let reorderCategory = null;
let reorderLastY = 0;
let reorderTouchY = 0;
let reorderDragOffset = 0;
let reorderChanged = false;
let reorderStartItems = null;
let reorderStartVisibleIds = [];
let suppressNextTap = false;
let reorderAutoScrollSpeed = 0;
let reorderAutoScrollFrame = null;
let reorderScrollRemainder = 0;

let modalIcon = "共";
let modalCategory = "other";
let isCategoryPickerOpen = false;
let isOwnerPickerOpen = false;

let pendingUpdateAction = null;
let pendingUpdateErrorCode = "";
let pendingConflictAction = null;
let serverVersion = 0;

let isImmediateSaveRunning = false;
let immediateSaveQueued = false;
let immediateSaveQueue = [];
let pendingSpareChanges = new Map();
let spareSaveTimer = null;
let isSpareBatchSaveRunning = false;
let spareBatchSavePromise = null;
let spareFlushDeferredUntilImmediateSave = false;
let isModeSaving = false;

let isRefreshing = false;
let itemsScrollInitialized = false;
let isInitialLoading = true;

let pullStartY = 0;
let pullDistance = 0;
let isPulling = false;

let isLoadFailureModalOpen = false;
let isConflictReloading = false;

let safeActionTouch = null;
let suppressNativeClickUntil = 0;
let wentBackgroundWhileSaving = false;
let backgroundReturnCheckTimer = null;
let isBackgroundSaveRecoveryRunning = false;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ========================================
// 共通タッチ判定
// ========================================
function getActionElementFromEvent(event) {
  if (!event || !event.target || typeof event.target.closest !== "function") return null;
  return event.target.closest("[data-action]");
}

function isActionElementDisabled(element) {
  if (!element) return true;
  if (element.disabled) return true;
  if (element.getAttribute("aria-disabled") === "true") return true;
  return false;
}

function isTouchInsideElement(touch, element) {
  if (!touch || !element) return false;
  const endElement = document.elementFromPoint(touch.clientX, touch.clientY);
  return !!(endElement && element.contains(endElement));
}

function getActionEventProxy(event) {
  return {
    originalEvent: event,
    preventDefault() {
      if (event && typeof event.preventDefault === "function" && event.cancelable) {
        event.preventDefault();
      }
    },
    stopPropagation() {
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
    },
    stopImmediatePropagation() {
      if (event && typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    }
  };
}

function executeSafeAction(element, event) {
  if (!element || isActionElementDisabled(element)) return;
  if (isConflictReloading && !element.closest("#conflictModal")) return;
  if (isRefreshing && !element.closest(".modal")) return;

  const action = element.dataset.action;
  const safeEvent = getActionEventProxy(event);

  switch (action) {
    case "start-title":
      startFromTitleScreen();
      break;
    case "toggle-shopping":
      toggleShoppingMode();
      break;
    case "open-home-cancel":
      openHomeCancelConfirm();
      break;
    case "open-add":
      openAddModal();
      break;
    case "copy-shopping":
      copyShoppingList(safeEvent);
      break;
    case "open-purchase-confirm":
      openPurchaseConfirm();
      break;
    case "hide-toast":
      hideToast();
      break;
    case "close-item-modal":
      closeItemModal();
      break;
    case "toggle-category-picker":
      toggleCategoryPicker(safeEvent);
      break;
    case "toggle-owner-picker":
      toggleOwnerPicker(safeEvent);
      break;
    case "confirm-item-modal":
      confirmItemModal();
      break;
    case "close-delete-confirm":
      closeDeleteConfirm();
      break;
    case "confirm-delete-item":
      confirmDeleteItem();
      break;
    case "close-purchase-confirm":
      closePurchaseConfirm();
      break;
    case "confirm-purchase-complete":
      confirmPurchaseComplete();
      break;
    case "close-home-cancel-confirm":
      closeHomeCancelConfirm();
      break;
    case "confirm-home-cancel":
      confirmHomeCancel();
      break;
    case "cancel-pending-update":
      cancelPendingUpdate();
      break;
    case "retry-pending-update":
      retryPendingUpdate();
      break;
    case "load-latest-conflict":
      loadLatestFromConflict();
      break;
    case "return-title-load-failure":
      returnToTitleFromLoadFailure();
      break;
    case "retry-load-failure":
      retryLoadFromFailure();
      break;
    case "set-owner-tab":
      setOwnerTab(element.dataset.owner || "all");
      break;
    case "toggle-category-collapse":
      toggleCategoryCollapse(element.dataset.category || "other");
      break;
    case "edit-swiped-item":
      editSwipedItem(safeEvent, element.dataset.itemId);
      break;
    case "delete-swiped-item":
      deleteSwipedItem(safeEvent, element.dataset.itemId);
      break;
    case "toggle-spare":
      toggleSpare(Number(element.dataset.index));
      break;
    case "select-category":
      safeEvent.stopPropagation();
      setModalCategory(element.dataset.category || "other");
      break;
    case "select-owner":
      safeEvent.stopPropagation();
      setModalIcon(element.dataset.owner || "共");
      break;
    default:
      break;
  }
}

function setupSafeActionHandlers() {
  document.addEventListener("touchstart", event => {
    const element = getActionElementFromEvent(event);
    if (!element || isActionElementDisabled(element)) {
      safeActionTouch = null;
      return;
    }
    if (!event.touches || event.touches.length !== 1) {
      safeActionTouch = null;
      return;
    }

    const touch = event.touches[0];
    safeActionTouch = {
      element: element,
      startX: touch.clientX,
      startY: touch.clientY,
      moved: false
    };
  }, { passive: true, capture: true });

  document.addEventListener("touchmove", event => {
    if (!safeActionTouch || !event.touches || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const dx = Math.abs(touch.clientX - safeActionTouch.startX);
    const dy = Math.abs(touch.clientY - safeActionTouch.startY);

    if (dx > BUTTON_TAP_MOVE_CANCEL_DISTANCE || dy > BUTTON_TAP_MOVE_CANCEL_DISTANCE) {
      safeActionTouch.moved = true;
    }
  }, { passive: true, capture: true });

  document.addEventListener("touchend", event => {
    if (!safeActionTouch) return;

    const state = safeActionTouch;
    safeActionTouch = null;
    suppressNativeClickUntil = Date.now() + 800;

    if (!event.changedTouches || event.changedTouches.length !== 1) return;

    const touch = event.changedTouches[0];
    const dx = Math.abs(touch.clientX - state.startX);
    const dy = Math.abs(touch.clientY - state.startY);

    if (dx > BUTTON_TAP_MOVE_CANCEL_DISTANCE || dy > BUTTON_TAP_MOVE_CANCEL_DISTANCE) return;
    if (state.moved) return;
    if (!isTouchInsideElement(touch, state.element)) return;
    if (isActionElementDisabled(state.element)) return;

    executeSafeAction(state.element, event);
  }, { passive: false });

  document.addEventListener("touchcancel", () => {
    safeActionTouch = null;
    suppressNativeClickUntil = Date.now() + 800;
  }, { passive: true, capture: true });

  document.addEventListener("click", event => {
    const element = getActionElementFromEvent(event);
    if (!element) return;

    if (Date.now() < suppressNativeClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }

    if (isActionElementDisabled(element)) return;

    event.preventDefault();
    event.stopPropagation();
    executeSafeAction(element, event);
  }, true);
}

// ========================================
// 起動画面・トースト
// ========================================
function setupStartupScreen() {
  const visual = document.getElementById("startupVisual");
  const title = document.getElementById("startupTitle");
  const version = document.getElementById("startupVersion");
  const message = document.getElementById("startupMessage");
  const startButton = document.getElementById("startupStartButton");

  if (visual) visual.textContent = "🧺";
  if (title) title.textContent = "日用品リスト";
  if (version) version.textContent = "ver" + APP_VERSION;
  if (message) message.textContent = "";
  if (startButton) startButton.classList.remove("show");
}

function startStartupToastTimer() {
  const screen = document.getElementById("startupScreen");
  const startupToast = document.getElementById("startupToast");
  if (!screen || !startupToast) return;

  clearTimeout(startupToastTimer);
  startupToastTimer = setTimeout(() => {
    if (isInitialLoading) {
      startupToast.textContent = "起動中…";
      screen.classList.add("show-toast");
    }
  }, 4000);
}

function showToast(message, duration = 2200) {
  const toast = document.getElementById("toast");
  if (!toast) return;

  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, duration);
}

function hideToast() {
  const toast = document.getElementById("toast");
  if (!toast) return;

  clearTimeout(toastTimer);
  toast.classList.remove("show");
}

function hideStartupScreen() {
  if (!isInitialLoading) return;

  isInitialLoading = false;
  clearTimeout(startupToastTimer);

  const screen = document.getElementById("startupScreen");
  if (!screen) return;

  screen.classList.remove("show-toast");
  screen.classList.add("hide");

  setTimeout(() => {
    screen.style.display = "none";
  }, 260);
}

function createId() {
  return Date.now().toString() + "-" + Math.random().toString(36).slice(2);
}

function cloneItems(sourceItems) {
  return JSON.parse(JSON.stringify(sourceItems));
}

function areArraysSame(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

function setOwnerTab(tabKey) {
  if (isModeSaving || isReordering || isRefreshing) return;
  if (closeSwipedItemIfOpen()) return;
  activeOwnerTab = tabKey;
  closeSwipedItemWithoutRender();
  render();
}

function getItemsForOwnerTab(tabKey) {
  const baseItems = shoppingMode
    ? items.filter(item => shoppingModeItemIds.has(item.id))
    : items;

  if (tabKey === "all") {
    return baseItems;
  }

  return baseItems.filter(item => item.icon === tabKey);
}

function getOwnerTabStockClass(tabKey) {
  const targetItems = getItemsForOwnerTab(tabKey);

  if (targetItems.length === 0) {
    return "empty";
  }

  const hasNoStock = targetItems.some(item => !item.hasSpare);
  return hasNoStock ? "stock-ng" : "stock-ok";
}

function renderOwnerTabs() {
  const tabContainer = document.getElementById("ownerTabs");
  if (!tabContainer) return;

  tabContainer.innerHTML = "";

  OWNER_TABS.forEach(tab => {
    const button = document.createElement("button");
    const isActive = activeOwnerTab === tab.key;
    const stockClass = getOwnerTabStockClass(tab.key);

    button.type = "button";
    button.className = `owner-tab ${stockClass} ${isActive ? "active" : ""}`;
    button.textContent = tab.full;
    button.setAttribute("aria-label", tab.full);
    button.disabled = isModeSaving || isReordering || isRefreshing;
    button.dataset.action = "set-owner-tab";
    button.dataset.owner = tab.key;

    tabContainer.appendChild(button);
  });
}

function getCategoryOrder(category) {
  const index = CATEGORY_LABELS.findIndex(label => label.key === category);
  return index >= 0 ? index : CATEGORY_LABELS.length - 1;
}

function getCategoryName(category) {
  const label = CATEGORY_LABELS.find(label => label.key === category);
  return label ? label.name : "その他";
}

function getOwnerOptionName(icon) {
  const owner = OWNER_OPTIONS.find(option => option.key === icon);
  return owner ? owner.name : "共同";
}

function normalizeItems(data) {
  const normalized = data.map((item, index) => {
    const category = item.category || "other";
    const orderNumber = Number(item.categoryOrder);

    return {
      id: item.id || createId(),
      name: item.name || "",
      hasSpare: item.hasSpare === true || item.hasSpare === "TRUE",
      note: item.note || "",
      icon: item.icon || "共",
      category: category,
      categoryOrder: Number.isFinite(orderNumber) ? orderNumber : null,
      _loadedIndex: index
    };
  });

  fillMissingCategoryOrders(normalized);

  return normalized.map(item => {
    const { _loadedIndex, ...cleanItem } = item;
    return cleanItem;
  });
}

function fillMissingCategoryOrders(targetItems) {
  CATEGORY_LABELS.forEach(category => {
    const categoryItems = targetItems.filter(item => (item.category || "other") === category.key);

    categoryItems.sort((a, b) => {
      const aOrder = Number(a.categoryOrder);
      const bOrder = Number(b.categoryOrder);
      const aHasOrder = Number.isFinite(aOrder);
      const bHasOrder = Number.isFinite(bOrder);

      if (aHasOrder && bHasOrder && aOrder !== bOrder) {
        return aOrder - bOrder;
      }

      return (a._loadedIndex || 0) - (b._loadedIndex || 0);
    });

    categoryItems.forEach((item, index) => {
      item.categoryOrder = (index + 1) * ORDER_STEP;
    });
  });
}

function getOrderValue(item) {
  const value = Number(item.categoryOrder);
  return Number.isFinite(value) ? value : 999999;
}

function sortItemsByCategory(sourceItems) {
  return sourceItems
    .map(item => ({
      item: item,
      originalIndex: items.findIndex(baseItem => baseItem.id === item.id)
    }))
    .sort((a, b) => {
      const categoryDiff =
        getCategoryOrder(a.item.category || "other") -
        getCategoryOrder(b.item.category || "other");

      if (categoryDiff !== 0) {
        return categoryDiff;
      }

      const orderDiff = getOrderValue(a.item) - getOrderValue(b.item);

      if (orderDiff !== 0) {
        return orderDiff;
      }

      return a.originalIndex - b.originalIndex;
    })
    .map(entry => entry.item);
}

function normalizeCategoryOrderFor(category) {
  const categoryItems = items
    .filter(item => (item.category || "other") === (category || "other"))
    .sort((a, b) => {
      const orderDiff = getOrderValue(a) - getOrderValue(b);
      if (orderDiff !== 0) return orderDiff;
      return items.findIndex(item => item.id === a.id) - items.findIndex(item => item.id === b.id);
    });

  categoryItems.forEach((item, index) => {
    item.categoryOrder = (index + 1) * ORDER_STEP;
  });
}

function getNextCategoryOrder(category) {
  const categoryItems = items.filter(item => (item.category || "other") === (category || "other"));

  if (categoryItems.length === 0) {
    return ORDER_STEP;
  }

  const maxOrder = Math.max(...categoryItems.map(item => getOrderValue(item)));
  return Number.isFinite(maxOrder) ? maxOrder + ORDER_STEP : (categoryItems.length + 1) * ORDER_STEP;
}

function toggleCategoryCollapse(category) {
  if (isModeSaving || isReordering || isRefreshing) return;
  if (closeSwipedItemIfOpen()) return;

  const key = category || "other";

  if (collapsedCategories.has(key)) {
    collapsedCategories.delete(key);
  } else {
    collapsedCategories.add(key);
  }

  closeSwipedItemWithoutRender();
  render();
}

function getSavingButtonHtml() {
  return `<span class="button-spinner" aria-hidden="true"></span><span>保存中…</span>`;
}

function updateActionButtons() {
  const purchaseCompleteButton = document.getElementById("purchaseCompleteButton");
  const cancelButton = document.getElementById("shoppingCancelTopButton");
  const addButton = document.querySelector(".add-top-button");
  const copyButton = document.getElementById("shoppingCopyButton");

  if (cancelButton) {
    cancelButton.disabled = isModeSaving || isReordering || isRefreshing;
  }

  if (addButton) {
    addButton.disabled = isModeSaving || isReordering || isRefreshing;
  }

  if (copyButton) {
    const copyCount = getShoppingCopyItems().length;
    copyButton.disabled = isModeSaving || isReordering || isRefreshing || copyCount === 0;
  }

  if (purchaseCompleteButton) {
    const isSavingThisButton = isModeSaving && shoppingMode;
    const hasShoppingTargets = shoppingModeItemIds.size > 0;
    const checkedCount = getCheckedShoppingItemCount();
    purchaseCompleteButton.disabled = isModeSaving || isRefreshing || !hasShoppingTargets || checkedCount === 0;
    purchaseCompleteButton.classList.toggle("saving", isSavingThisButton);
    purchaseCompleteButton.classList.toggle("has-checked", checkedCount > 0);
    purchaseCompleteButton.innerHTML = isSavingThisButton
      ? getSavingButtonHtml()
      : "購入確定";
  }

  updateSaveStatusIndicator();
}

function setModeSaving(saving) {
  isModeSaving = saving;
  updateActionButtons();
  renderOwnerTabs();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function getOwnerName(icon) {
  if (icon === "か") return "かずまさ";
  if (icon === "み") return "みゆう";
  return "共同";
}

function getOwnerMarkClass(icon) {
  if (icon === "み") return "owner-mi";
  if (icon === "か") return "owner-ka";
  return "owner-common";
}

// ========================================
// データ読み込み・保存
// ========================================
function resetModesAndSelections() {
  shoppingModeItemIds.clear();
  shoppingMode = false;
  isModeSaving = false;
  swipedItemId = null;
  resetPullRefreshVisual();
}

function isBlockingModalOpen() {
  return isLoadFailureModalOpen || isConflictReloading || isRefreshing;
}

function applyLoadedItemsResponse(response) {
  const loadedItems = Array.isArray(response) ? response : (response.items || []);

  if (!Array.isArray(response) && response.version !== undefined) {
    serverVersion = Number(response.version) || 0;
  }

  items = normalizeItems(loadedItems);

  if (!shoppingMode) {
    shoppingModeItemIds.clear();
  }

  render();
  hideStartupScreen();
}


function loadItems(options = {}) {
  const fromPull = options.fromPull === true;
  const afterLoadMessage = options.afterLoadMessage || "";

  if (fromPull && shoppingMode) {
    resetPullRefreshVisual();
    return;
  }

  if (fromPull) {
    isRefreshing = true;
    pullDistance = REFRESH_OFFSET;
    updateActionButtons();
    updateRefreshIndicator();
    updatePullRefreshVisual();
  }

  const callbackName = "loadItemsCallback_" + Date.now();

  window[callbackName] = function(response) {
    applyLoadedItemsResponse(response);

    if (afterLoadMessage) {
      showToast(afterLoadMessage);
    }

    if (fromPull) {
      finishPullRefresh();
    }

    delete window[callbackName];
    script.remove();
  };

  const script = document.createElement("script");
  script.src = WEB_APP_URL + "?callback=" + encodeURIComponent(callbackName);

  script.onerror = function() {
    hideStartupScreen();

    if (fromPull) {
      finishPullRefresh();
    }

    openLoadFailureModal("リストを読み込めませんでした。\n通信状況を確認してください。");

    delete window[callbackName];
    script.remove();
  };

  document.body.appendChild(script);
}

async function reloadLatestItemsFromServer() {
  const response = await requestJsonp({});
  applyLoadedItemsResponse(response);
}

function clearPendingSaveState() {
  pendingUpdateAction = null;
  pendingUpdateErrorCode = "";
  pendingConflictAction = null;
  pendingSpareChanges.clear();
  if (spareSaveTimer) {
    clearTimeout(spareSaveTimer);
    spareSaveTimer = null;
  }
  immediateSaveQueue = [];
  immediateSaveQueued = false;
}

async function discardPendingChangesAndReloadLatest(message) {
  clearPendingSaveState();
  resetModesAndSelections();
  hideToast();
  resetPullRefreshVisual();
  openBlockingLoadingModal("最新読み込み", "最新リストを読み込んでいます。");

  try {
    await reloadLatestItemsFromServer();
    closeBlockingLoadingModal();
    if (message) {
      showToast(message);
    }
  } catch (error) {
    console.error(error);
    closeBlockingLoadingModal();
    openLoadFailureModal("リストを読み込めませんでした。\n通信状況を確認してください。");
  }
}

function requestJsonp(params) {
  return new Promise((resolve, reject) => {
    const callbackName = "jsonpCallback_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    let settled = false;
    let timeoutId = null;

    function cleanup() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      delete window[callbackName];
      if (script.parentNode) {
        script.remove();
      }
    }

    function settleSuccess(response) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    }

    function settleError(message, code) {
      if (settled) return;
      settled = true;
      cleanup();
      const error = new Error(message || "通信に失敗しました");
      error.code = code || "N01";
      reject(error);
    }

    const query = new URLSearchParams();
    query.set("callback", callbackName);

    Object.keys(params).forEach(key => {
      query.set(key, params[key]);
    });

    window[callbackName] = function(response) {
      settleSuccess(response);
    };

    script.onerror = function() {
      settleError("通信に失敗しました", "N01");
    };

    timeoutId = setTimeout(() => {
      settleError("保存がタイムアウトしました", "N02");
    }, SAVE_TIMEOUT_MS);

    script.src = WEB_APP_URL + "?" + query.toString();
    document.body.appendChild(script);
  });
}

function createSavePayload(action, data = {}, requestMeta = {}) {
  return {
    ...data,
    action: action,
    baseVersion: serverVersion || 0,
    clientId: requestMeta.clientId || getClientId(),
    requestId: requestMeta.requestId || createRequestId()
  };
}

function getErrorCodeFromResult(result, fallbackCode) {
  if (result && result.code) return String(result.code);
  return fallbackCode || "N01";
}

function createSaveError(result, fallbackMessage, fallbackCode) {
  const error = new Error(result && result.message ? result.message : fallbackMessage || "保存に失敗しました");
  error.code = getErrorCodeFromResult(result, fallbackCode || "S01");
  error.result = result || null;
  return error;
}

function getOrderPayloadForCategory(category) {
  const key = category || "other";
  return items
    .filter(item => (item.category || "other") === key)
    .sort((a, b) => {
      const orderDiff = getOrderValue(a) - getOrderValue(b);
      if (orderDiff !== 0) return orderDiff;
      return items.findIndex(base => base.id === a.id) - items.findIndex(base => base.id === b.id);
    })
    .map((item, index) => ({
      i: item.id,
      o: index + 1
    }));
}

function buildSaveMutation(action, data = {}) {
  return {
    action: action,
    ...data
  };
}

async function saveItemsToServer(options = {}) {
  const mutation = options.mutation || null;
  const action = mutation && mutation.action ? mutation.action : "";
  if (!mutation || !action) {
    throw createSaveError({ status: "error", code: "D01", message: "Missing save action" }, "保存処理が不正です", "D01");
  }
  const requestMeta = {
    clientId: options.clientId || getClientId(),
    requestId: options.requestId || createRequestId()
  };
  const payload = createSavePayload(action, mutation, requestMeta);

  const payloadText = JSON.stringify(payload);
  return requestJsonp({
    action: action,
    baseVersion: String(serverVersion || 0),
    clientId: requestMeta.clientId,
    requestId: requestMeta.requestId,
    payload: payloadText
  });
}

function saveRequestToServer(request) {
  const safeRequest = ensureSaveRequest(request);
  return saveItemsToServer({
    mutation: safeRequest.mutation,
    clientId: safeRequest.clientId,
    requestId: safeRequest.requestId
  });
}

function isConflictResult(result) {
  return result && result.status === "conflict";
}

function isOkResult(result) {
  return result && result.status === "ok";
}

function applySaveSuccess(result) {
  if (result && result.version !== undefined) {
    const nextVersion = Number(result.version);
    if (Number.isFinite(nextVersion) && nextVersion > 0) {
      serverVersion = nextVersion;
    }
  }
}

function hasPendingSaveWork() {
  return isImmediateSaveRunning ||
    immediateSaveQueued ||
    immediateSaveQueue.length > 0 ||
    !!spareSaveTimer ||
    pendingSpareChanges.size > 0 ||
    isSpareBatchSaveRunning ||
    spareFlushDeferredUntilImmediateSave;
}

function updateSaveStatusIndicator() {
  const saveStatus = document.getElementById("saveStatus");
  const visible = !shoppingMode && hasPendingSaveWork();

  if (saveStatus) {
    saveStatus.textContent = visible ? "保存中…" : "";
    saveStatus.classList.toggle("visible", visible);
  }

  if (document.getElementById("app")) {
    updateAppModeClasses();
  }
}

function hasImmediateSaveWork() {
  return isImmediateSaveRunning || immediateSaveQueued || immediateSaveQueue.length > 0;
}

function deferSpareFlushUntilImmediateSaveDone() {
  if (spareSaveTimer) {
    clearTimeout(spareSaveTimer);
    spareSaveTimer = null;
  }
  spareFlushDeferredUntilImmediateSave = true;
  updateSaveStatusIndicator();
}

function scheduleDeferredSpareFlushNow() {
  if (spareSaveTimer || pendingSpareChanges.size === 0) return;

  spareFlushDeferredUntilImmediateSave = false;
  spareSaveTimer = setTimeout(() => {
    spareSaveTimer = null;
    flushSpareChanges();
  }, 0);
  updateSaveStatusIndicator();
}

function buildSpareChangesPayload(changesMap) {
  return Array.from(changesMap.entries()).map(([id, hasSpare]) => ({
    i: id,
    s: hasSpare === true
  }));
}

function scheduleSpareSave(id, hasSpare) {
  pendingSpareChanges.set(String(id), hasSpare === true);

  if (spareSaveTimer) {
    clearTimeout(spareSaveTimer);
  }

  spareSaveTimer = setTimeout(() => {
    spareSaveTimer = null;
    flushSpareChanges();
  }, SPARE_SAVE_DEBOUNCE_MS);

  updateSaveStatusIndicator();
}

function createSpareChangesRequest(changes) {
  const mutation = buildSaveMutation("updateSpares", {
    changes: changes
  });
  return createSaveRequest(mutation);
}

function saveSpareChangesRequest(request) {
  return saveRequestToServer(request);
}

function createDeferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

async function flushSpareChanges() {
  if (isSpareBatchSaveRunning) {
    if (spareBatchSavePromise) {
      await spareBatchSavePromise;
    }
    return pendingSpareChanges.size === 0;
  }

  // 追加・編集・削除・並び替えなどの保存が先に走っている場合は、
  // 在庫トグルの一括保存を送信せず、先行保存の完了後にまとめて送る。
  // 送信直前の最新 serverVersion を使うため。
  if (hasImmediateSaveWork()) {
    deferSpareFlushUntilImmediateSaveDone();
    return true;
  }

  spareFlushDeferredUntilImmediateSave = false;

  if (spareSaveTimer) {
    clearTimeout(spareSaveTimer);
    spareSaveTimer = null;
  }

  if (pendingSpareChanges.size === 0) {
    updateSaveStatusIndicator();
    return true;
  }

  const changes = buildSpareChangesPayload(pendingSpareChanges);
  const request = createSpareChangesRequest(changes);
  pendingSpareChanges.clear();
  isSpareBatchSaveRunning = true;
  const spareBatchDeferred = createDeferredPromise();
  spareBatchSavePromise = spareBatchDeferred.promise;
  let completedNormally = false;
  updateSaveStatusIndicator();

  try {
    const result = await saveSpareChangesRequest(request);

    if (isOkResult(result)) {
      applySaveSuccess(result);
      completedNormally = true;
      return true;
    }

    if (isConflictResult(result)) {
      pendingConflictAction = null;
      openConflictModal();
      return false;
    }

    throw createSaveError(result, "保存に失敗しました", "S01");
  } catch (error) {
    console.error(error);
    pendingUpdateAction = () => saveSpareChangesFromPendingAction(request);
    pendingUpdateAction._actionName = "updateSpares";
    pendingUpdateAction._pendingRequests = [cloneSaveRequest(request)];
    openUpdateRetryModal(error && error.code ? error.code : "N01");
    return false;
  } finally {
    isSpareBatchSaveRunning = false;
    spareBatchSavePromise = null;
    spareBatchDeferred.resolve(completedNormally);

    if (completedNormally && pendingSpareChanges.size > 0 && !spareSaveTimer) {
      spareSaveTimer = setTimeout(() => {
        spareSaveTimer = null;
        flushSpareChanges();
      }, SPARE_SAVE_DEBOUNCE_MS);
    }

    updateSaveStatusIndicator();
  }
}

async function saveSpareChangesFromPendingAction(request) {
  const safeRequest = cloneSaveRequest(request);
  isSpareBatchSaveRunning = true;
  updateSaveStatusIndicator();

  try {
    const result = await saveSpareChangesRequest(safeRequest);

    if (isOkResult(result)) {
      applySaveSuccess(result);
      return;
    }

    if (isConflictResult(result)) {
      pendingConflictAction = null;
      openConflictModal();
      return;
    }

    throw createSaveError(result, "保存に失敗しました", "S01");
  } catch (error) {
    console.error(error);
    pendingUpdateAction = () => saveSpareChangesFromPendingAction(safeRequest);
    pendingUpdateAction._actionName = "updateSpares";
    pendingUpdateAction._pendingRequests = [cloneSaveRequest(safeRequest)];
    openUpdateRetryModal(error && error.code ? error.code : "N01");
  } finally {
    isSpareBatchSaveRunning = false;
    updateSaveStatusIndicator();
  }
}

function getMutationActionName(mutation) {
  return mutation && mutation.action ? String(mutation.action) : "unknown";
}

function createPendingUpdateAction(mutation) {
  const request = createSaveRequest(mutation || null);
  const action = () => runImmediateSaveRequests([request]);
  action._actionName = getMutationActionName(mutation);
  action._pendingRequests = [cloneSaveRequest(request)];
  return action;
}

function createPendingImmediateRequestsAction(requests) {
  const retryRequests = clonePendingRequests(requests);
  const action = () => runImmediateSaveRequests(retryRequests);
  const firstMutation = retryRequests.length > 0 ? retryRequests[0].mutation : null;
  action._actionName = getMutationActionName(firstMutation);
  action._pendingRequests = clonePendingRequests(retryRequests);
  return action;
}

async function runImmediateSaveRequests(requests) {
  const requestQueue = requests
    .filter(request => request)
    .map(request => cloneSaveRequest(request));

  if (requestQueue.length === 0) return;

  if (isSpareBatchSaveRunning && spareBatchSavePromise) {
    await spareBatchSavePromise;
  }

  if (pendingSpareChanges.size > 0 || spareSaveTimer) {
    const spareFlushSucceeded = await flushSpareChanges();
    if (spareFlushSucceeded === false) {
      return;
    }
  }

  if (isImmediateSaveRunning) {
    immediateSaveQueue.push(...requestQueue);
    immediateSaveQueued = true;
    updateSaveStatusIndicator();
    return;
  }

  isImmediateSaveRunning = true;
  updateSaveStatusIndicator();

  let currentRequest = requestQueue.shift() || null;

  try {
    while (currentRequest) {
      immediateSaveQueued = immediateSaveQueue.length > 0 || requestQueue.length > 0;

      const mutation = currentRequest.mutation;
      const result = await saveRequestToServer(currentRequest);

      if (isOkResult(result)) {
        applySaveSuccess(result);
      } else if (isConflictResult(result)) {
        immediateSaveQueue = [];
        immediateSaveQueued = false;
        pendingConflictAction = null;
        openConflictModal();
        return;
      } else {
        throw createSaveError(result, "保存に失敗しました", "S01");
      }

      currentRequest = requestQueue.shift() || immediateSaveQueue.shift() || null;
    }
  } catch (error) {
    console.error(error);
    const remainingRequests = currentRequest ? [currentRequest, ...requestQueue, ...immediateSaveQueue] : [...requestQueue, ...immediateSaveQueue];
    immediateSaveQueue = [];
    immediateSaveQueued = false;
    pendingUpdateAction = createPendingImmediateRequestsAction(remainingRequests);
    openUpdateRetryModal(error && error.code ? error.code : "N01");
  } finally {
    isImmediateSaveRunning = false;
    immediateSaveQueued = immediateSaveQueue.length > 0;

    if (!isImmediateSaveRunning && immediateSaveQueue.length === 0 && pendingSpareChanges.size > 0) {
      scheduleDeferredSpareFlushNow();
    }

    updateSaveStatusIndicator();
  }
}

async function saveImmediateChange(mutation = null) {
  const firstRequest = createSaveRequest(mutation);

  return runImmediateSaveRequests([firstRequest]);
}

async function commitModeAndExit(successMessage, existingRequest = null) {
  if (isModeSaving) return;

  const purchaseIds = Array.from(shoppingModeItemIds).filter(id => {
    const item = items.find(item => item.id === id);
    return item && item.hasSpare === true;
  });

  if (!existingRequest && purchaseIds.length === 0) return;

  const request = existingRequest
    ? cloneSaveRequest(existingRequest)
    : createSaveRequest(buildSaveMutation("completePurchase", { ids: purchaseIds }));

  setModeSaving(true);

  try {
    const result = await saveRequestToServer(request);

    if (isOkResult(result)) {
      applySaveSuccess(result);

      shoppingMode = false;
      isModeSaving = false;
      shoppingModeItemIds.clear();
      resetPullRefreshVisual();
      render();

      showToast(successMessage);
      return;
    }

    if (isConflictResult(result)) {
      setModeSaving(false);
      pendingConflictAction = null;
      openConflictModal();
      return;
    }

    throw createSaveError(result, "保存に失敗しました", "S01");
  } catch (error) {
    console.error(error);
    setModeSaving(false);
    pendingUpdateAction = () => commitModeAndExit(successMessage, request);
    pendingUpdateAction._actionName = "completePurchase";
    pendingUpdateAction._pendingRequests = [cloneSaveRequest(request)];
    openUpdateRetryModal(error && error.code ? error.code : "N01");
  }
}

function restoreShoppingModeDraftChanges() {
  if (!shoppingMode || shoppingModeItemIds.size === 0) return;

  const targetIds = new Set(shoppingModeItemIds);
  items = items.map(item => {
    if (!targetIds.has(item.id)) return item;
    if (item.hasSpare === false) return item;
    return { ...item, hasSpare: false };
  });
}

function exitModeWithoutSaving() {
  restoreShoppingModeDraftChanges();
  shoppingMode = false;
  isModeSaving = false;
  shoppingModeItemIds.clear();
  resetPullRefreshVisual();
  render();
}

function setupSwipeCloseGuards() {
  const container = document.getElementById("items");
  if (!container) return;

  container.addEventListener("touchstart", event => {
    if (!swipedItemId) return;
    if (event.target.closest(".swipe-action-button")) return;

    const openRow = event.target.closest(".row.swipe-open");
    if (openRow) return;

    event.preventDefault();
    event.stopPropagation();
    closeSwipedItem();
  }, { passive: false, capture: true });

  container.addEventListener("touchmove", event => {
    if (!swipedItemId) return;
    if (event.target.closest(".swipe-action-button")) return;

    const openRow = event.target.closest(".row.swipe-open");
    if (openRow) return;

    event.preventDefault();
    event.stopPropagation();
  }, { passive: false, capture: true });
}

// ========================================
// 描画
// ========================================
function render() {
  updateAppModeClasses();
  renderOwnerTabs();
  updateActionButtons();

  const container = document.getElementById("items");
  const previousScrollTop = container.scrollTop;
  const shouldInitializeScroll = !itemsScrollInitialized;

  container.innerHTML = "";
  container.appendChild(createPullRefreshElement());

  const displayItems = getDisplayItems();

  if (displayItems.length === 0) {
    if (shoppingMode) {
      renderEmptyShoppingMessage(container);
    } else {
      renderEmptyListMessage(container);
    }

    restoreItemsScroll(container, previousScrollTop, shouldInitializeScroll);
    updatePullRefreshVisual();
    return;
  }

  let previousCategory = null;
  displayItems.forEach(item => {
    const currentCategory = item.category || "other";

    if (currentCategory !== previousCategory) {
      const categoryCount = displayItems.filter(displayItem => (displayItem.category || "other") === currentCategory).length;
      container.appendChild(createCategoryHeading(currentCategory, false, categoryCount));
      previousCategory = currentCategory;
    }

    if (!collapsedCategories.has(currentCategory)) {
      container.appendChild(createItemRow(item));
    }
  });

  restoreItemsScroll(container, previousScrollTop, shouldInitializeScroll);
  updatePullRefreshVisual();
  updateActionButtons();

  if (pendingFocusItemId) {
    requestAnimationFrame(() => {
      scrollToPendingFocusItem();
    });
  }
}

function revealAddedItem(id) {
  const item = items.find(item => item.id === id);
  if (!item) return;

  const category = item.category || "other";

  collapsedCategories.delete(category);

  if (activeOwnerTab !== "all" && item.icon !== activeOwnerTab) {
    activeOwnerTab = "all";
  }

  pendingFocusItemId = id;
  highlightedItemId = id;

  clearTimeout(highlightTimer);

  render();

  setTimeout(() => {
    scrollToPendingFocusItem();
  }, 320);

  highlightTimer = setTimeout(() => {
    highlightedItemId = null;
    render();
  }, 1800);
}

function scrollToPendingFocusItem() {
  if (!pendingFocusItemId) return;

  const targetId = pendingFocusItemId;
  pendingFocusItemId = null;

  const container = document.getElementById("items");
  if (!container) return;

  const rows = Array.from(container.querySelectorAll(".row[data-item-id]"));
  const target = rows.find(row => row.dataset.itemId === targetId);

  if (!target) return;

  resetPullRefreshVisual();

  requestAnimationFrame(() => {
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const currentTop = container.scrollTop;
    const targetTop =
      currentTop +
      (targetRect.top - containerRect.top) -
      (container.clientHeight / 2) +
      (target.offsetHeight / 2);

    const maxTop = Math.max(container.scrollHeight - container.clientHeight, 0);
    const nextTop = Math.min(Math.max(targetTop, 0), maxTop);

    container.scrollTo({
      top: nextTop,
      behavior: "smooth"
    });

    setTimeout(() => {
      resetPullRefreshVisual();
      if (document.scrollingElement) {
        document.scrollingElement.scrollTop = 0;
      }
      window.scrollTo(0, 0);
    }, 520);
  });
}

function updateAppModeClasses() {
  const app = document.getElementById("app");
  const appTitle = document.getElementById("appTitle");
  const shoppingButton = document.querySelector(".shopping-button");
  const cancelButton = document.getElementById("shoppingCancelTopButton");
  const addButton = document.querySelector(".add-top-button");
  const copyButton = document.getElementById("shoppingCopyButton");
  const themeColorMeta = document.getElementById("themeColorMeta");

  if (app) {
    app.classList.toggle("shopping-mode", shoppingMode);
    app.classList.toggle("reordering", isReordering);
    app.classList.toggle("has-swipe-open", !!swipedItemId);
  }
  document.body.classList.toggle("shopping-mode", shoppingMode);

  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", shoppingMode ? "#fff7e8" : "#f5f5f5");
  }

  if (shoppingButton) {
    shoppingButton.disabled = isModeSaving || isReordering || isRefreshing || (!shoppingMode && hasPendingSaveWork());
  }

  if (cancelButton) {
    cancelButton.disabled = isModeSaving || isReordering || isRefreshing;
  }

  if (addButton) {
    addButton.disabled = isModeSaving || isReordering || isRefreshing;
  }

  if (copyButton) {
    const copyCount = getShoppingCopyItems().length;
    copyButton.disabled = isModeSaving || isReordering || isRefreshing || copyCount === 0;
  }

  if (appTitle) {
    appTitle.textContent = shoppingMode ? "買い物リスト" : "日用品リスト";
  }
}

function createPullRefreshElement() {
  const refresh = document.createElement("div");
  refresh.className = "pull-refresh";
  refresh.innerHTML = `<span class="refresh-icon ${isRefreshing ? "spinning" : ""}" id="refreshIcon"></span>`;
  return refresh;
}

function restoreItemsScroll(container, previousScrollTop, shouldInitializeScroll) {
  requestAnimationFrame(() => {
    if (shouldInitializeScroll) {
      container.scrollTop = 0;
      itemsScrollInitialized = true;
      return;
    }

    if (isRefreshing || isReordering) return;

    container.scrollTop = Math.max(previousScrollTop, 0);
  });
}

function updateRefreshIndicator() {
  const icon = document.getElementById("refreshIcon");
  if (!icon) return;
  icon.classList.toggle("spinning", isRefreshing);
}

function updatePullRefreshVisual() {
  const container = document.getElementById("items");
  const refresh = document.querySelector(".pull-refresh");
  if (!container || !refresh) return;

  const visible = pullDistance > 0 || isRefreshing;
  const distance = isRefreshing ? REFRESH_OFFSET : pullDistance;
  const contentOffset = visible ? distance : 0;

  container.style.setProperty("--pull-content-offset", contentOffset + "px");

  container.classList.toggle("pull-moving", isPulling && !isRefreshing);
  container.classList.toggle("pull-settling", !isPulling || isRefreshing);

  refresh.style.transform = `translateY(${distance}px)`;
  refresh.classList.toggle("visible", visible);
  refresh.classList.toggle("ready", pullDistance >= PULL_TRIGGER_DISTANCE && !isRefreshing);

  updateRefreshIndicator();
}

function resetPullRefreshVisual() {
  const container = document.getElementById("items");

  isPulling = false;
  pullStartY = 0;
  pullDistance = 0;

  if (container) {
    container.classList.remove("pull-moving");
    container.classList.add("pull-settling");
  }

  updatePullRefreshVisual();

  setTimeout(() => {
    if (container) {
      container.classList.remove("pull-settling");
    }
  }, 240);
}


function isItemHorizontalSwipeActive() {
  return !!swipeItemId && swipeDirection === "horizontal";
}

function shouldBlockPullRefreshBySwipe() {
  return isItemHorizontalSwipeActive();
}

function setupPullToRefresh() {
  const container = document.getElementById("items");

  container.addEventListener("touchstart", event => {
    if (shoppingMode || isModeSaving || isReordering || isRefreshing || isBlockingModalOpen()) return;
    if (container.scrollTop > 0) return;
    if (!event.touches || event.touches.length !== 1) return;

    isPulling = true;
    pullStartY = event.touches[0].clientY;
    pullDistance = 0;
    updatePullRefreshVisual();
  }, { passive: true });

  container.addEventListener("touchmove", event => {
    if (!isPulling) return;
    if (shoppingMode || isModeSaving || isReordering || isRefreshing || isBlockingModalOpen() || shouldBlockPullRefreshBySwipe()) {
      resetPullRefreshVisual();
      return;
    }

    const currentY = event.touches[0].clientY;
    const deltaY = currentY - pullStartY;

    if (deltaY <= 0 || container.scrollTop > 0) {
      pullDistance = 0;
      updatePullRefreshVisual();
      return;
    }

    pullDistance = Math.min(deltaY * 0.55, PULL_MAX_DISTANCE);
    updatePullRefreshVisual();

    if (deltaY > 6) {
      event.preventDefault();
    }
  }, { passive: false });

  container.addEventListener("touchend", () => {
    if (!isPulling) return;

    const shouldRefresh =
      pullDistance >= PULL_TRIGGER_DISTANCE &&
      !shoppingMode &&
      !isModeSaving &&
      !isReordering &&
      !isRefreshing &&
      !isBlockingModalOpen() &&
      !shouldBlockPullRefreshBySwipe();

    isPulling = false;

    if (shouldRefresh) {
      loadItems({ fromPull: true });
    } else {
      resetPullRefreshVisual();
    }
  }, { passive: true });

  container.addEventListener("touchcancel", () => {
    resetPullRefreshVisual();
  }, { passive: true });
}

function finishPullRefresh() {
  const container = document.getElementById("items");

  requestAnimationFrame(() => {
    container.scrollTo({
      top: 0,
      behavior: "smooth"
    });

    setTimeout(() => {
      isRefreshing = false;
      resetPullRefreshVisual();
      updateActionButtons();
    }, 350);
  });
}

function sortShoppingItems(sourceItems) {
  return sourceItems
    .map(item => ({
      item: item,
      originalIndex: items.findIndex(baseItem => baseItem.id === item.id)
    }))
    .sort((a, b) => {
      const categoryDiff =
        getCategoryOrder(a.item.category || "other") -
        getCategoryOrder(b.item.category || "other");

      if (categoryDiff !== 0) {
        return categoryDiff;
      }


      const orderDiff = getOrderValue(a.item) - getOrderValue(b.item);
      if (orderDiff !== 0) {
        return orderDiff;
      }

      return a.originalIndex - b.originalIndex;
    })
    .map(entry => entry.item);
}

function getDisplayItems() {
  let displayItems = shoppingMode
    ? items.filter(item => shoppingModeItemIds.has(item.id))
    : items;

  if (activeOwnerTab !== "all") {
    displayItems = displayItems.filter(item => item.icon === activeOwnerTab);
  }

  return shoppingMode ? sortShoppingItems(displayItems) : sortItemsByCategory(displayItems);
}

function getCheckedShoppingItemCount() {
  if (!shoppingMode) return 0;

  return Array.from(shoppingModeItemIds).filter(id => {
    const item = items.find(baseItem => baseItem.id === id);
    return item && item.hasSpare === true;
  }).length;
}

function getVisibleReorderItemsForCategory(category) {
  return getDisplayItems().filter(item => (item.category || "other") === (category || "other"));
}

function createDoubleChevronSvg(direction) {
  if (direction === "up") {
    return `
      <svg viewBox="0 0 12 14" aria-hidden="true">
        <path d="M2 6L6 2L10 6"></path>
        <path d="M2 10L6 6L10 10"></path>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 12 14" aria-hidden="true">
      <path d="M2 2L6 6L10 2"></path>
      <path d="M2 6L6 10L10 6"></path>
    </svg>
  `;
}

function createCheckSvg() {
  return `
    <span class="picker-check" aria-hidden="true">
      <svg viewBox="0 0 16 16">
        <path d="M3.5 8.4L6.6 11.3L12.7 4.7"></path>
      </svg>
    </span>
  `;
}

function createCategoryHeading(category, showStockLegend = false, count = 0) {
  const heading = document.createElement("div");
  const isCollapsed = collapsedCategories.has(category || "other");
  const arrowDirection = isCollapsed ? "down" : "up";

  heading.className = `category-heading ${isCollapsed ? "collapsed" : ""}`;

  heading.innerHTML = `
    <button
      class="category-heading-button"
      type="button"
      data-action="toggle-category-collapse"
      data-category="${category || "other"}"
      aria-label="${getCategoryName(category || "other")}の表示切り替え"
    >
      <span>${getCategoryName(category || "other")}</span>
      <span class="category-count" aria-hidden="true">${count}件</span>
      <span class="category-arrow" aria-hidden="true">
        ${createDoubleChevronSvg(arrowDirection)}
      </span>
    </button>
  `;

  return heading;
}

function renderEmptyShoppingMessage(container) {
  const empty = document.createElement("div");
  empty.className = "empty-list-message";
  empty.textContent = activeOwnerTab === "all"
    ? "不足しているものはありません"
    : getOwnerName(activeOwnerTab) + "の不足しているものはありません";
  container.appendChild(empty);
}

function renderEmptyListMessage(container) {
  const empty = document.createElement("div");
  empty.className = "empty-list-message";

  if (activeOwnerTab === "all") {
    empty.textContent = "日用品はありません";
  } else {
    empty.textContent = getOwnerName(activeOwnerTab) + "の日用品はありません";
  }

  container.appendChild(empty);
}

function createItemRow(item) {
  const index = items.findIndex(baseItem => baseItem.id === item.id);
  const isOpen = swipedItemId === item.id;
  const isActiveReorder = isReordering && reorderItemId === item.id;
  const shouldHighlight = highlightedItemId === item.id;
  const row = document.createElement("div");

  const wasRecentlyToggled = recentlyToggledItemId === item.id;
  row.className = `row ${item.hasSpare ? "has-spare" : "no-spare"} ${isOpen ? "swipe-open" : ""} ${isActiveReorder ? "reorder-active" : ""} ${shouldHighlight ? "item-highlight" : ""} ${wasRecentlyToggled ? "stock-just-toggled" : ""}`;
  row.dataset.itemId = item.id;

  if (isActiveReorder) {
    row.style.setProperty("--reorder-offset-y", reorderDragOffset + "px");
  }

  row.innerHTML = `
    <div
      class="swipe-frame"
      ontouchstart="startItemTouch(event, '${item.id}')"
      ontouchmove="moveItemTouch(event)"
      ontouchend="endItemTouch(event, '${item.id}')"
      ontouchcancel="cancelItemTouch()"
    >
      <div class="swipe-actions">
        <button class="swipe-action-button delete" data-action="delete-swiped-item" data-item-id="${item.id}" aria-label="日用品を削除">
          ${createTrashIcon("swipe-action-icon")}
        </button>
        <button class="swipe-action-button edit" data-action="edit-swiped-item" data-item-id="${item.id}" aria-label="日用品を編集">
          ${createPencilIcon("swipe-action-icon")}
        </button>
      </div>

      <div class="item">
        ${createIconHtml(item)}
        ${createItemContentHtml(item, index)}
      </div>
    </div>
  `;

  return row;
}

function createIconHtml(item) {
  return `
    <div class="icon-wrap">
      <div class="owner-mark ${getOwnerMarkClass(item.icon)}" aria-label="使用者：${getOwnerName(item.icon)}">
        ${item.icon}
      </div>
    </div>
  `;
}

function createPencilIcon(className) {
  return `
    <svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19L6.3 14.2L16.4 4.1L19.9 7.6L9.8 17.7L5 19Z"></path>
      <path d="M14.8 5.7L18.3 9.2"></path>
    </svg>
  `;
}

function createTrashIcon(className) {
  return `
    <svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7H19"></path>
      <path d="M9 7V5H15V7"></path>
      <path d="M8 10V19"></path>
      <path d="M16 10V19"></path>
      <path d="M7 7L8 21H16L17 7"></path>
    </svg>
  `;
}

function createShoppingCheckHtml(item, index) {
  const checked = item.hasSpare;

  return `
    <button
      class="shopping-check-button ${checked ? "checked" : "unchecked"}"
      type="button"
      ${isModeSaving || isReordering ? "disabled" : ""}
      data-action="toggle-spare"
      data-index="${index}"
      aria-label="${checked ? "購入済み" : "未購入"}"
    >
      <span class="shopping-checkbox" aria-hidden="true">
        <svg viewBox="0 0 16 16">
          <path d="M3.2 8.3L6.5 11.3L12.8 4.7"></path>
        </svg>
      </span>
      <span>${checked ? "済み" : "購入"}</span>
    </button>
  `;
}

function createStockToggleHtml(item, index) {
  const label = item.hasSpare ? "不足にする" : "ありにする";
  const text = item.hasSpare ? "あり" : "不足";
  const className = item.hasSpare ? "has-spare" : "no-spare";

  return `
    <button
      class="spare-badge ${className}"
      type="button"
      ${isModeSaving || isReordering ? "disabled" : ""}
      data-action="toggle-spare"
      data-index="${index}"
      aria-label="${label}"
      title="${label}"
    >
      <span class="spare-badge-text">${text}</span>
    </button>
  `;
}

function createItemContentHtml(item, index) {
  const hasNote = item.note.trim().length > 0;

  return `
    <div class="text-area ${hasNote ? "" : "no-note"}">
      <div class="name-text ${item.name ? "" : "empty-text"}">
        ${escapeHtml(item.name || "名称未入力")}
      </div>
      ${hasNote ? `<div class="note-text">${escapeHtml(item.note)}</div>` : ""}
    </div>

    ${shoppingMode ? createShoppingCheckHtml(item, index) : createStockToggleHtml(item, index)}
  `;
}

function startItemTouch(event, id) {
  if (shoppingMode || isModeSaving || isReordering || isBlockingModalOpen()) return;
  if (!event.touches || event.touches.length !== 1) return;

  if (swipedItemId && swipedItemId !== id) {
    event.preventDefault();
    event.stopPropagation();
    closeSwipedItem();
    return;
  }

  if (event.target.closest(".swipe-action-button")) return;

  const isOpenItem = swipedItemId === id;

  swipeFrameElement = event.currentTarget;
  swipeItemElement = swipeFrameElement.querySelector(".item");

  if (!swipeItemElement) return;

  swipeItemId = id;
  swipeStartX = event.touches[0].clientX;
  swipeStartY = event.touches[0].clientY;
  swipeCurrentX = swipeStartX;
  swipeCurrentY = swipeStartY;
  swipeBaseOffset = swipedItemId === id ? -SWIPE_ACTION_WIDTH : 0;
  swipeMoved = false;
  swipeCanceled = false;
  swipeDirection = null;

  clearTimeout(reorderHoldTimer);
  if (!isOpenItem) {
    reorderHoldTimer = setTimeout(() => {
      beginReorder(id, swipeCurrentY);
    }, REORDER_HOLD_MS);
  }
}

function moveItemTouch(event) {
  if (isReordering) {
    event.preventDefault();
    event.stopPropagation();
    handleReorderMove(event);
    return;
  }

  if (!swipeItemId || swipeCanceled || !swipeItemElement) return;
  if (!event.touches || event.touches.length !== 1) return;

  swipeCurrentX = event.touches[0].clientX;
  swipeCurrentY = event.touches[0].clientY;

  const deltaX = swipeCurrentX - swipeStartX;
  const deltaY = swipeCurrentY - swipeStartY;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (absX > REORDER_CANCEL_MOVE || absY > REORDER_CANCEL_MOVE) {
    clearTimeout(reorderHoldTimer);
  }

  if (!swipeDirection && (absX > 8 || absY > 8)) {
    swipeDirection = absX > absY ? "horizontal" : "vertical";
  }

  if (swipeDirection === "vertical") {
    swipeCanceled = true;
    if (swipedItemId && swipeItemId === swipedItemId) {
      swipedItemId = null;
      cancelItemTouch();
      render();
      return;
    }
    cancelItemTouch();
    return;
  }

  if (swipeDirection !== "horizontal") return;

  swipeMoved = true;
  event.preventDefault();

  if (swipeFrameElement) {
    swipeFrameElement.classList.add("swipe-active");
  }

  swipeItemElement.classList.add("swiping");

  const offset = clamp(swipeBaseOffset + deltaX, -SWIPE_ACTION_WIDTH, 0);
  swipeItemElement.style.transform = `translateX(${offset}px)`;
}

function endItemTouch(event, id) {
  clearTimeout(reorderHoldTimer);

  if (isReordering) {
    finishReorder();
    return;
  }

  if (!swipeItemId || swipeItemId !== id) {
    cancelItemTouch();
    return;
  }

  const deltaX = swipeCurrentX - swipeStartX;

  if (swipedItemId === id && !swipeCanceled && !swipeMoved) {
    swipedItemId = null;
    cancelItemTouch();
    render();
    return;
  }

  // ただのタップでは親カード側で再描画しない。
  // 在庫トグルの click が touchend 後に自然に発火できるようにする。
  if (!swipeMoved && !swipeCanceled && !swipeDirection) {
    cancelItemTouch();
    return;
  }

  if (!shoppingMode && !isModeSaving && !swipeCanceled && swipeDirection === "horizontal") {
    if (swipeBaseOffset === 0) {
      if (deltaX <= -SWIPE_OPEN_THRESHOLD) {
        swipedItemId = id;
      } else {
        swipedItemId = null;
      }
    } else {
      if (deltaX >= SWIPE_CLOSE_THRESHOLD) {
        swipedItemId = null;
      } else {
        swipedItemId = id;
      }
    }
  }

  if (swipeMoved) {
    suppressNextTap = true;
    setTimeout(() => {
      suppressNextTap = false;
    }, 300);
  }

  cancelItemTouch();
  render();
}

// ========================================
// スワイプ操作
// ========================================
function cancelItemTouch() {
  clearTimeout(reorderHoldTimer);
  resetSwipeVisual();

  swipeItemId = null;
  swipeStartX = 0;
  swipeStartY = 0;
  swipeCurrentX = 0;
  swipeCurrentY = 0;
  swipeBaseOffset = 0;
  swipeMoved = false;
  swipeCanceled = false;
  swipeDirection = null;
  swipeFrameElement = null;
  swipeItemElement = null;
}

function resetSwipeVisual() {
  if (swipeItemElement) {
    swipeItemElement.classList.remove("swiping");
    swipeItemElement.style.transform = "";
  }

  if (swipeFrameElement) {
    swipeFrameElement.classList.remove("swipe-active");
  }
}

function beginReorder(id, startY) {
  if (shoppingMode || isModeSaving || isRefreshing) return;

  const item = items.find(item => item.id === id);
  if (!item) return;

  closeSwipedItemWithoutRender();
  resetSwipeVisual();
  resetPullRefreshVisual();

  reorderStartItems = cloneItems(items);
  reorderCategory = item.category || "other";
  reorderStartVisibleIds = getVisibleReorderItemsForCategory(reorderCategory).map(item => item.id);

  isReordering = true;
  reorderItemId = id;
  reorderLastY = startY;
  reorderTouchY = startY;
  reorderDragOffset = 0;
  reorderChanged = false;
  suppressNextTap = true;
  reorderAutoScrollSpeed = 0;
  reorderScrollRemainder = 0;

  document.addEventListener("touchmove", handleReorderMove, { passive: false });
  document.addEventListener("touchend", finishReorder, { passive: true });
  document.addEventListener("touchcancel", cancelReorder, { passive: true });

  render();
}

function handleReorderMove(event) {
  if (!isReordering || !event.touches || event.touches.length !== 1) return;

  if (event._reorderHandled) return;
  event._reorderHandled = true;

  event.preventDefault();

  const currentY = event.touches[0].clientY;
  reorderTouchY = currentY;

  updateReorderAutoScroll(currentY);

  const deltaY = currentY - reorderLastY;
  reorderDragOffset = clamp(deltaY, -REORDER_STEP_DISTANCE, REORDER_STEP_DISTANCE);
  updateReorderVisualOffset();

  if (Math.abs(deltaY) < REORDER_STEP_DISTANCE) return;

  const direction = deltaY > 0 ? "down" : "up";
  const moved = moveReorderItemOneStep(direction);

  reorderDragOffset = 0;

  if (moved) {
    reorderChanged = true;
    reorderLastY = currentY;
    render();
  } else {
    resetReorderDragBaseline();
  }
}

function updateReorderVisualOffset() {
  const activeRow = document.querySelector(".row.reorder-active");
  if (!activeRow) return;

  activeRow.style.setProperty("--reorder-offset-y", reorderDragOffset + "px");
}

function resetReorderDragBaseline() {
  reorderDragOffset = 0;
  reorderScrollRemainder = 0;
  reorderLastY = reorderTouchY;
  updateReorderVisualOffset();
}

function updateReorderAutoScroll(currentY) {
  const container = document.getElementById("items");
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const topDistance = currentY - rect.top;
  const bottomDistance = rect.bottom - currentY;

  let speed = 0;

  if (topDistance < REORDER_AUTO_SCROLL_ZONE) {
    const ratio = (REORDER_AUTO_SCROLL_ZONE - topDistance) / REORDER_AUTO_SCROLL_ZONE;
    speed = -Math.ceil(ratio * REORDER_AUTO_SCROLL_MAX_SPEED);
  } else if (bottomDistance < REORDER_AUTO_SCROLL_ZONE) {
    const ratio = (REORDER_AUTO_SCROLL_ZONE - bottomDistance) / REORDER_AUTO_SCROLL_ZONE;
    speed = Math.ceil(ratio * REORDER_AUTO_SCROLL_MAX_SPEED);
  }

  if (speed !== 0 && !canAutoScrollReorder(speed > 0 ? "down" : "up")) {
    speed = 0;
    resetReorderDragBaseline();
  }

  reorderAutoScrollSpeed = speed;

  if (speed !== 0) {
    startReorderAutoScroll();
  } else {
    stopReorderAutoScroll();
  }
}

function canAutoScrollReorder(direction) {
  if (!reorderItemId || !reorderCategory) return false;

  const visibleItems = getVisibleReorderItemsForCategory(reorderCategory);
  const currentIndex = visibleItems.findIndex(item => item.id === reorderItemId);

  if (currentIndex < 0) return false;

  if (direction === "up") {
    return currentIndex > 0;
  }

  if (direction === "down") {
    return currentIndex < visibleItems.length - 1;
  }

  return false;
}

function startReorderAutoScroll() {
  if (reorderAutoScrollFrame) return;

  const step = () => {
    reorderAutoScrollFrame = null;

    if (!isReordering || reorderAutoScrollSpeed === 0) return;

    const direction = reorderAutoScrollSpeed > 0 ? "down" : "up";

    if (!canAutoScrollReorder(direction)) {
      stopReorderAutoScroll();
      resetReorderDragBaseline();
      return;
    }

    const container = document.getElementById("items");
    if (!container) return;

    const before = container.scrollTop;
    container.scrollTop = before + reorderAutoScrollSpeed;
    const actualMove = container.scrollTop - before;

    if (actualMove !== 0) {
      reorderScrollRemainder += actualMove;

      if (Math.abs(reorderScrollRemainder) >= REORDER_STEP_DISTANCE) {
        const moved = moveReorderItemOneStep(direction);

        reorderScrollRemainder = 0;
        reorderDragOffset = 0;
        reorderLastY = reorderTouchY;

        if (moved) {
          reorderChanged = true;
          render();
        } else {
          stopReorderAutoScroll();
          updateReorderVisualOffset();
        }
      }
    } else {
      stopReorderAutoScroll();
      resetReorderDragBaseline();
      return;
    }

    if (isReordering && reorderAutoScrollSpeed !== 0) {
      reorderAutoScrollFrame = requestAnimationFrame(step);
    }
  };

  reorderAutoScrollFrame = requestAnimationFrame(step);
}

function stopReorderAutoScroll() {
  reorderAutoScrollSpeed = 0;
  reorderScrollRemainder = 0;

  if (reorderAutoScrollFrame) {
    cancelAnimationFrame(reorderAutoScrollFrame);
    reorderAutoScrollFrame = null;
  }
}

function moveReorderItemOneStep(direction) {
  if (!reorderItemId || !reorderCategory) return false;

  const visibleItems = getVisibleReorderItemsForCategory(reorderCategory);
  const currentIndex = visibleItems.findIndex(item => item.id === reorderItemId);

  if (currentIndex < 0) return false;

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= visibleItems.length) return false;

  const movingItem = visibleItems[currentIndex];
  const targetItem = visibleItems[targetIndex];

  if (!movingItem || !targetItem) return false;
  if ((movingItem.category || "other") !== (targetItem.category || "other")) return false;

  if (direction === "up") {
    moveItemBeforeInCategory(movingItem.id, targetItem.id, reorderCategory);
  } else {
    moveItemAfterInCategory(movingItem.id, targetItem.id, reorderCategory);
  }

  return true;
}

function moveItemBeforeInCategory(movingId, targetId, category) {
  const categoryItems = getCategoryItemsInOrder(category);
  const movingIndex = categoryItems.findIndex(item => item.id === movingId);
  if (movingIndex < 0) return;

  const [movingItem] = categoryItems.splice(movingIndex, 1);
  const targetIndex = categoryItems.findIndex(item => item.id === targetId);

  if (targetIndex < 0) {
    categoryItems.push(movingItem);
  } else {
    categoryItems.splice(targetIndex, 0, movingItem);
  }

  applyCategoryOrder(category, categoryItems);
}

function moveItemAfterInCategory(movingId, targetId, category) {
  const categoryItems = getCategoryItemsInOrder(category);
  const movingIndex = categoryItems.findIndex(item => item.id === movingId);
  if (movingIndex < 0) return;

  const [movingItem] = categoryItems.splice(movingIndex, 1);
  const targetIndex = categoryItems.findIndex(item => item.id === targetId);

  if (targetIndex < 0) {
    categoryItems.push(movingItem);
  } else {
    categoryItems.splice(targetIndex + 1, 0, movingItem);
  }

  applyCategoryOrder(category, categoryItems);
}

function getCategoryItemsInOrder(category) {
  return items
    .filter(item => (item.category || "other") === (category || "other"))
    .sort((a, b) => {
      const orderDiff = getOrderValue(a) - getOrderValue(b);
      if (orderDiff !== 0) return orderDiff;
      return items.findIndex(item => item.id === a.id) - items.findIndex(item => item.id === b.id);
    });
}

function applyCategoryOrder(category, orderedCategoryItems) {
  orderedCategoryItems.forEach((item, index) => {
    const baseItem = items.find(base => base.id === item.id);
    if (baseItem) {
      baseItem.categoryOrder = (index + 1) * ORDER_STEP;
    }
  });
}

function finalizeReorderFromSnapshot() {
  if (!reorderStartItems || !reorderCategory) {
    return false;
  }

  const finalVisibleIds = getVisibleReorderItemsForCategory(reorderCategory).map(item => item.id);

  items = cloneItems(reorderStartItems);

  if (areArraysSame(reorderStartVisibleIds, finalVisibleIds)) {
    return false;
  }

  applyFinalVisibleOrderToSnapshot(reorderCategory, reorderStartVisibleIds, finalVisibleIds);
  normalizeCategoryOrderFor(reorderCategory);

  return true;
}

function applyFinalVisibleOrderToSnapshot(category, startVisibleIds, finalVisibleIds) {
  const currentVisibleIds = startVisibleIds.slice();

  finalVisibleIds.forEach((id, targetIndex) => {
    let currentIndex = currentVisibleIds.indexOf(id);

    while (currentIndex > targetIndex) {
      const previousId = currentVisibleIds[currentIndex - 1];

      moveItemBeforeInCategory(id, previousId, category);

      currentVisibleIds.splice(currentIndex, 1);
      currentVisibleIds.splice(currentIndex - 1, 0, id);
      currentIndex--;
    }

    while (currentIndex < targetIndex) {
      const nextId = currentVisibleIds[currentIndex + 1];

      moveItemAfterInCategory(id, nextId, category);

      currentVisibleIds.splice(currentIndex, 1);
      currentVisibleIds.splice(currentIndex + 1, 0, id);
      currentIndex++;
    }
  });
}

function finishReorder() {
  if (!isReordering) return;

  const categoryForSave = reorderCategory || "other";
  const shouldSave = finalizeReorderFromSnapshot();
  const ordersForSave = shouldSave ? getOrderPayloadForCategory(categoryForSave) : [];

  cleanupReorder();
  render();

  if (shouldSave) {
    saveImmediateChange(buildSaveMutation("updateOrder", {
      category: categoryForSave,
      orders: ordersForSave
    }));
  }

  setTimeout(() => {
    suppressNextTap = false;
  }, 300);
}

// ========================================
// 並び替え
// ========================================
function cancelReorder() {
  if (!isReordering) return;

  if (reorderStartItems) {
    items = cloneItems(reorderStartItems);
  }

  cleanupReorder();
  render();

  setTimeout(() => {
    suppressNextTap = false;
  }, 300);
}

function cleanupReorder() {
  document.removeEventListener("touchmove", handleReorderMove);
  document.removeEventListener("touchend", finishReorder);
  document.removeEventListener("touchcancel", cancelReorder);

  stopReorderAutoScroll();

  isReordering = false;
  reorderItemId = null;
  reorderCategory = null;
  reorderLastY = 0;
  reorderTouchY = 0;
  reorderDragOffset = 0;
  reorderChanged = false;
  reorderStartItems = null;
  reorderStartVisibleIds = [];
  reorderScrollRemainder = 0;

  cancelItemTouch();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function handleItemTap(event, id) {
  if (isBlockingModalOpen()) {
    event.stopPropagation();
    return;
  }

  if (suppressNextTap) {
    event.stopPropagation();
    return;
  }

  if (swipeMoved) {
    event.stopPropagation();
    return;
  }

  if (swipedItemId && swipedItemId === id) {
    event.stopPropagation();
    closeSwipedItem();
  } else if (swipedItemId && swipedItemId !== id) {
    event.stopPropagation();
    closeSwipedItem();
  }
}

function closeSwipedItem() {
  if (!swipedItemId) return;
  swipedItemId = null;
  render();
}

function closeSwipedItemIfOpen() {
  if (!swipedItemId) return false;
  closeSwipedItem();
  return true;
}

function closeSwipedItemWithoutRender() {
  swipedItemId = null;
}

function editSwipedItem(event, id) {
  event.stopPropagation();
  if (isReordering) return;

  closeSwipedItemWithoutRender();
  render();
  openEditModal(id);
}

function deleteSwipedItem(event, id) {
  event.stopPropagation();
  if (isReordering) return;

  closeSwipedItemWithoutRender();
  render();
  openDeleteConfirm(id);
}

function toggleSpare(index) {
  if (isModeSaving || isReordering || suppressNextTap || isBlockingModalOpen()) return;

  if (swipedItemId) {
    closeSwipedItem();
    return;
  }

  if (index < 0 || !items[index]) return;

  closeSwipedItemWithoutRender();
  items[index].hasSpare = !items[index].hasSpare;
  recentlyToggledItemId = items[index].id;
  clearTimeout(recentlyToggledTimer);
  recentlyToggledTimer = setTimeout(() => {
    recentlyToggledItemId = null;
    render();
  }, 420);

  if (shoppingMode) {
    render();
  } else {
    scheduleSpareSave(items[index].id, items[index].hasSpare);
    render();
  }
}


function getShoppingCopyItems() {
  if (shoppingMode && shoppingModeItemIds.size > 0) {
    const targetIds = new Set(shoppingModeItemIds);
    return sortItemsByCategory(items.filter(item => targetIds.has(item.id)));
  }

  return sortItemsByCategory(items.filter(item => !item.hasSpare));
}

function formatShoppingCopyDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} ${hour}:${minute}`;
}

function getOwnerSuffix(icon) {
  const ownerName = getOwnerName(icon);
  return ownerName === "共同" ? "" : `（${ownerName}）`;
}

function buildShoppingListText() {
  const targetItems = getShoppingCopyItems();
  const lines = ["買い物リスト", formatShoppingCopyDate(new Date()), ""];
  let previousCategory = null;

  targetItems.forEach(item => {
    const category = item.category || "other";

    if (category !== previousCategory) {
      if (previousCategory !== null) {
        lines.push("");
      }

      lines.push(`【${getCategoryName(category)}】`);
      previousCategory = category;
    }

    lines.push(`□ ${item.name}${getOwnerSuffix(item.icon)}`);

    if (item.note) {
      lines.push(`  メモ：${item.note}`);
    }
  });

  return lines.join("\n").trimEnd();
}

function copyTextFallback(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let success = false;

  try {
    success = document.execCommand("copy");
  } catch (error) {
    success = false;
  }

  document.body.removeChild(textarea);
  return success;
}

function showCopyButtonDone() {
  const button = document.getElementById("shoppingCopyButton");
  if (!button) return;

  button.classList.add("copied");
  clearTimeout(copyButtonFeedbackTimer);

  copyButtonFeedbackTimer = setTimeout(() => {
    button.classList.remove("copied");
  }, COPY_FEEDBACK_MS);
}

async function copyShoppingList(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (isModeSaving || isReordering) return;

  const targetItems = getShoppingCopyItems();

  if (targetItems.length === 0) {
    showToast("コピーするものがありません");
    return;
  }

  const text = buildShoppingListText();

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else if (!copyTextFallback(text)) {
      throw new Error("copy failed");
    }

    showCopyButtonDone();
    showToast("コピーしました", COPY_FEEDBACK_MS);
  } catch (error) {
    if (copyTextFallback(text)) {
      showCopyButtonDone();
      showToast("コピーしました", COPY_FEEDBACK_MS);
    } else {
      showToast("コピーできませんでした");
    }
  }
}

function toggleShoppingMode() {
  if (isModeSaving || isReordering || isRefreshing || hasPendingSaveWork()) return;
  if (closeSwipedItemIfOpen()) return;

  closeSwipedItemWithoutRender();

  shoppingMode = true;
  resetPullRefreshVisual();

  shoppingModeItemIds = new Set(
    items
      .filter(item => !item.hasSpare)
      .map(item => item.id)
  );

  render();
}

function openItemModalWithPageTransition() {
  const modal = document.getElementById("itemModal");

  clearTimeout(itemModalCloseTimer);
  modal.classList.remove("show");
  modal.classList.remove("closing");
  modal.classList.add("page-visible");

  modal.offsetHeight;

  requestAnimationFrame(() => {
    modal.classList.add("show");
  });
}

function openAddModal() {
  if (shoppingMode || isModeSaving || isReordering) return;
  if (closeSwipedItemIfOpen()) return;

  closeSwipedItemWithoutRender();

  modalMode = "add";
  editingItemId = null;
  modalIcon = "共";
  modalCategory = "other";
  isCategoryPickerOpen = false;
  isOwnerPickerOpen = false;

  document.getElementById("itemModalTitle").textContent = "日用品を追加";
  document.getElementById("modalName").value = "";
  document.getElementById("modalNote").value = "";
  document.getElementById("modalConfirm").disabled = true;

  renderCategoryPicker();
  renderOwnerPicker();
  openItemModalWithPageTransition();
}

function openEditModal(id) {
  if (isModeSaving || isReordering) return;

  closeSwipedItemWithoutRender();

  const item = items.find(item => item.id === id);
  if (!item) return;

  modalMode = "edit";
  editingItemId = id;
  modalIcon = item.icon || "共";
  modalCategory = item.category || "other";
  isCategoryPickerOpen = false;
  isOwnerPickerOpen = false;

  document.getElementById("itemModalTitle").textContent = "日用品を編集";
  document.getElementById("modalName").value = item.name || "";
  document.getElementById("modalNote").value = item.note || "";
  document.getElementById("modalConfirm").disabled = !(item.name || "").trim();

  renderCategoryPicker();
  renderOwnerPicker();
  openItemModalWithPageTransition();
}

function closeItemModal() {
  if (isModeSaving) return;

  closeCategoryPicker();
  closeOwnerPicker();

  const modal = document.getElementById("itemModal");
  if (!modal || !modal.classList.contains("page-visible")) return;

  clearTimeout(itemModalCloseTimer);
  modal.classList.add("closing");

  itemModalCloseTimer = setTimeout(() => {
    modal.classList.remove("show");
    modal.classList.remove("page-visible");
    modal.classList.remove("closing");
  }, 260);
}

function setModalIcon(icon) {
  if (isModeSaving) return;
  modalIcon = icon || "共";
  isOwnerPickerOpen = false;
  renderOwnerPicker();
}

function setModalCategory(category) {
  if (isModeSaving) return;
  modalCategory = category || "other";
  isCategoryPickerOpen = false;
  renderCategoryPicker();
}

function toggleCategoryPicker(event) {
  if (event) event.stopPropagation();
  if (isModeSaving) return;

  isOwnerPickerOpen = false;
  isCategoryPickerOpen = !isCategoryPickerOpen;
  renderOwnerPicker();
  renderCategoryPicker();
}

function toggleOwnerPicker(event) {
  if (event) event.stopPropagation();
  if (isModeSaving) return;

  isCategoryPickerOpen = false;
  isOwnerPickerOpen = !isOwnerPickerOpen;
  renderCategoryPicker();
  renderOwnerPicker();
}

function closeCategoryPicker() {
  if (!isCategoryPickerOpen) return;
  isCategoryPickerOpen = false;
  renderCategoryPicker();
}

function closeOwnerPicker() {
  if (!isOwnerPickerOpen) return;
  isOwnerPickerOpen = false;
  renderOwnerPicker();
}

function renderCategoryPicker() {
  const picker = document.getElementById("categoryPicker");
  const label = document.getElementById("modalCategoryLabel");
  const menu = document.getElementById("categoryPickerMenu");

  if (!picker || !label || !menu) return;

  picker.classList.toggle("open", isCategoryPickerOpen);
  label.textContent = getCategoryName(modalCategory || "other");

  menu.innerHTML = "";

  CATEGORY_LABELS.forEach(category => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "picker-option";
    button.innerHTML = `
      <span>${category.name}</span>
      ${modalCategory === category.key ? createCheckSvg() : ""}
    `;
    button.dataset.action = "select-category";
    button.dataset.category = category.key;

    menu.appendChild(button);
  });
}

function renderOwnerPicker() {
  const picker = document.getElementById("ownerPicker");
  const label = document.getElementById("modalOwnerLabel");
  const menu = document.getElementById("ownerPickerMenu");

  if (!picker || !label || !menu) return;

  picker.classList.toggle("open", isOwnerPickerOpen);
  label.textContent = getOwnerOptionName(modalIcon || "共");

  menu.innerHTML = "";

  OWNER_OPTIONS.forEach(owner => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "picker-option";
    button.innerHTML = `
      <span>${owner.name}</span>
      ${modalIcon === owner.key ? createCheckSvg() : ""}
    `;
    button.dataset.action = "select-owner";
    button.dataset.owner = owner.key;

    menu.appendChild(button);
  });
}

function validateItemModal() {
  const name = document.getElementById("modalName").value.trim();
  document.getElementById("modalConfirm").disabled = name.length === 0 || isModeSaving;
}

function confirmItemModal() {
  if (isModeSaving) return;

  const name = document.getElementById("modalName").value.trim();
  const note = document.getElementById("modalNote").value.trim();

  if (!name) return;

  let addedItemId = null;
  let mutation = null;

  if (modalMode === "add") {
    addedItemId = addItemFromModal(name, note);
    const addedItem = items.find(item => item.id === addedItemId);
    mutation = buildSaveMutation("addItem", {
      item: addedItem
    });
  }

  if (modalMode === "edit") {
    const updatedItem = updateItemFromModal(name, note);
    mutation = buildSaveMutation("updateItem", {
      item: updatedItem
    });
  }

  closeItemModal();

  if (mutation) {
    saveImmediateChange(mutation);
  }

  if (addedItemId) {
    revealAddedItem(addedItemId);
  } else {
    render();
  }
}

function addItemFromModal(name, note) {
  const category = modalCategory || "other";
  const id = createId();

  items.push({
    id: id,
    name: name,
    hasSpare: false,
    note: note,
    icon: modalIcon,
    category: category,
    categoryOrder: getNextCategoryOrder(category)
  });

  return id;
}

function updateItemFromModal(name, note) {
  let updatedItem = null;
  let oldCategoryForNormalize = null;

  items = items.map(item => {
    if (item.id === editingItemId) {
      const oldCategory = item.category || "other";
      const newCategory = modalCategory || "other";
      const categoryChanged = oldCategory !== newCategory;

      oldCategoryForNormalize = oldCategory;
      updatedItem = {
        ...item,
        name: name,
        note: note,
        icon: modalIcon,
        category: newCategory,
        categoryOrder: categoryChanged ? getNextCategoryOrder(newCategory) : item.categoryOrder
      };

      return updatedItem;
    }

    return item;
  });

  if (oldCategoryForNormalize) {
    normalizeCategoryOrderFor(oldCategoryForNormalize);
  }
  normalizeCategoryOrderFor(modalCategory || "other");

  updatedItem = items.find(item => item.id === editingItemId) || updatedItem;
  return updatedItem;
}

// ========================================
// 追加・編集・削除・買い物モード
// ========================================
function openDeleteConfirm(id) {
  if (isModeSaving || isReordering) return;

  const item = items.find(item => item.id === id);
  if (!item) return;

  deletingItemId = id;

  document.getElementById("deleteConfirmMessage").textContent =
    "「" + (item.name || "名称未入力") + "」を削除しますか？";

  document.getElementById("deleteConfirmModal").classList.add("show");
}

function closeDeleteConfirm() {
  if (isModeSaving) return;
  deletingItemId = null;
  document.getElementById("deleteConfirmModal").classList.remove("show");
}

function confirmDeleteItem() {
  if (isModeSaving || !deletingItemId) return;

  const deletedId = deletingItemId;
  const deletedItem = items.find(item => item.id === deletedId);
  const deletedCategory = deletedItem ? deletedItem.category || "other" : "other";

  items = items.filter(item => item.id !== deletedId);
  deletingItemId = null;
  normalizeCategoryOrderFor(deletedCategory);

  document.getElementById("deleteConfirmModal").classList.remove("show");
  saveImmediateChange(buildSaveMutation("deleteItem", {
    id: deletedId,
    category: deletedCategory
  }));
  render();
}

function openPurchaseConfirm() {
  if (!shoppingMode || isModeSaving) return;

  const hasCheckedPurchaseItems = Array.from(shoppingModeItemIds).some(id => {
    const item = items.find(baseItem => baseItem.id === id);
    return item && item.hasSpare === true;
  });

  if (!hasCheckedPurchaseItems) {
    return;
  }

  const message = document.getElementById("purchaseConfirmMessage");
  if (message) {
    message.textContent = "チェックした日用品を購入済みにしますか？";
  }

  document.getElementById("purchaseConfirmModal").classList.add("show");
}

function closePurchaseConfirm() {
  if (isModeSaving) return;
  document.getElementById("purchaseConfirmModal").classList.remove("show");
}

function confirmPurchaseComplete() {
  if (isModeSaving) return;
  closePurchaseConfirm();
  commitModeAndExit("購入内容を保存しました");
}

// ========================================
// モーダル
// ========================================
function openHomeCancelConfirm() {
  if (isModeSaving) return;
  if (!shoppingMode) return;

  if (getCheckedShoppingItemCount() === 0) {
    exitModeWithoutSaving();
    return;
  }

  const message = document.getElementById("homeCancelConfirmMessage");
  if (message) {
    message.textContent = "購入チェックを破棄して戻りますか？";
  }

  document.getElementById("homeCancelConfirmModal").classList.add("show");
}

function closeHomeCancelConfirm() {
  if (isModeSaving) return;
  document.getElementById("homeCancelConfirmModal").classList.remove("show");
}

function confirmHomeCancel() {
  if (isModeSaving) return;

  closeHomeCancelConfirm();

  exitModeWithoutSaving();
}

function getUpdateRetryMessage() {
  return "保存結果を確認できませんでした。\n通信状況を確認して、再更新してください。";
}

function openUpdateRetryModal(errorCode, options = {}) {
  pendingUpdateErrorCode = errorCode ? String(errorCode) : "";

  if (!options.forceShow && ((document.hidden && wentBackgroundWhileSaving) || isBackgroundSaveRecoveryRunning)) {
    return;
  }

  if (isConflictReloading) {
    closeConflictModal();
  }

  hideToast();
  resetPullRefreshVisual();

  const message = document.getElementById("updateRetryMessage");
  if (message) {
    let text = getUpdateRetryMessage();
    if (errorCode) {
      text += "\nエラーコード：" + errorCode;
    }
    message.textContent = text;
  }

  document.getElementById("updateRetryModal").classList.add("show");
}

function closeUpdateRetryModal() {
  document.getElementById("updateRetryModal").classList.remove("show");
}

async function retryPendingUpdate() {
  closeUpdateRetryModal();

  if (typeof pendingUpdateAction === "function") {
    const action = pendingUpdateAction;
    pendingUpdateAction = null;
    pendingUpdateErrorCode = "";

    openBlockingLoadingModal("再更新中", "変更内容を保存しています。");

    try {
      await Promise.resolve(action());
    } finally {
      if (isConflictReloading) {
        closeConflictModal();
      }
    }
  }
}

async function cancelPendingUpdate() {
  closeUpdateRetryModal();
  await discardPendingChangesAndReloadLatest("最新状態に戻しました");
}

function openBlockingLoadingModal(titleText, messageText) {
  hideToast();
  resetPullRefreshVisual();

  isConflictReloading = true;

  const title = document.getElementById("conflictTitle");
  const message = document.getElementById("conflictMessage");
  const actions = document.getElementById("conflictActions");

  if (title) {
    title.textContent = titleText || "処理中";
  }

  if (message) {
    const safeMessage = escapeHtml(messageText || "しばらくお待ちください。");
    message.innerHTML = '<span class="inline-spinner" aria-hidden="true"></span><span>' + safeMessage + '</span>';
    message.classList.add("loading-message");
  }

  if (actions) {
    actions.style.display = "none";
  }

  document.getElementById("conflictModal").classList.add("show");
}

function closeBlockingLoadingModal() {
  if (isConflictReloading) {
    closeConflictModal();
  }
}

function setConflictModalLoading(isLoading) {
  isConflictReloading = isLoading === true;
  const title = document.getElementById("conflictTitle");
  const message = document.getElementById("conflictMessage");
  const actions = document.getElementById("conflictActions");

  if (title) {
    title.textContent = isLoading ? "最新読み込み" : "他の端末で更新されています";
  }

  if (message) {
    if (isLoading) {
      message.innerHTML = '<span class="inline-spinner" aria-hidden="true"></span><span>最新リストを読み込んでいます。</span>';
      message.classList.add("loading-message");
    } else {
      message.innerHTML = "他の端末でリストが更新されています。<br>最新リストを読み込んでください。";
      message.classList.remove("loading-message");
    }
  }

  if (actions) {
    actions.style.display = isLoading ? "none" : "flex";
  }
}

function openConflictModal() {
  hideToast();
  resetPullRefreshVisual();
  setConflictModalLoading(false);
  document.getElementById("conflictModal").classList.add("show");
}

function closeConflictModal() {
  document.getElementById("conflictModal").classList.remove("show");
  setConflictModalLoading(false);
}

async function loadLatestFromConflict() {
  closeConflictModal();
  await discardPendingChangesAndReloadLatest("最新リストを読み込みました");
}

function openLoadFailureModal(message) {
  if (isLoadFailureModalOpen) return;

  isLoadFailureModalOpen = true;
  hideToast();
  resetPullRefreshVisual();

  document.getElementById("loadFailureMessage").textContent = message;
  document.getElementById("loadFailureModal").classList.add("show");
}

function closeLoadFailureModal() {
  isLoadFailureModalOpen = false;
  document.getElementById("loadFailureModal").classList.remove("show");
}

function showTitleScreen(options = {}) {
  const showStartButton = options.showStartButton === true;

  isInitialLoading = true;
  clearTimeout(startupToastTimer);

  const screen = document.getElementById("startupScreen");
  const startupMessage = document.getElementById("startupMessage");
  const startButton = document.getElementById("startupStartButton");

  setupStartupScreen();

  if (startupMessage) {
    startupMessage.textContent = "";
  }

  if (startButton) {
    startButton.classList.toggle("show", showStartButton);
  }

  if (screen) {
    screen.style.display = "flex";
    screen.classList.remove("hide");
    screen.classList.remove("show-toast");
  }
}

function isAnySaveRunningNow() {
  return isImmediateSaveRunning || isSpareBatchSaveRunning || isModeSaving;
}

function rememberBackgroundSaveState() {
  if (hasPendingSaveWork() || isModeSaving || typeof pendingUpdateAction === "function") {
    wentBackgroundWhileSaving = true;
  }
}

function scheduleBackgroundReturnCheck(delay = 180) {
  if (backgroundReturnCheckTimer) {
    clearTimeout(backgroundReturnCheckTimer);
  }
  backgroundReturnCheckTimer = setTimeout(() => {
    backgroundReturnCheckTimer = null;
    handleBackgroundReturnAfterSave();
  }, delay);
}

function getResponseVersion(response) {
  if (response && !Array.isArray(response) && response.version !== undefined) {
    const version = Number(response.version);
    return Number.isFinite(version) ? version : 0;
  }
  return 0;
}

function getPendingBackgroundRequestsForCheck() {
  if (typeof pendingUpdateAction === "function" && Array.isArray(pendingUpdateAction._pendingRequests)) {
    return clonePendingRequests(pendingUpdateAction._pendingRequests);
  }

  if (pendingSpareChanges.size > 0) {
    const changes = buildSpareChangesPayload(pendingSpareChanges);
    return [{
      mutation: buildSaveMutation("updateSpares", { changes: changes })
    }];
  }

  if (immediateSaveQueue.length > 0) {
    return clonePendingRequests(immediateSaveQueue);
  }

  return [];
}

async function retryPendingWorkAfterBackground() {
  if (typeof pendingUpdateAction === "function") {
    const action = pendingUpdateAction;
    pendingUpdateAction = null;
    pendingUpdateErrorCode = "";
    await Promise.resolve(action());
    return;
  }

  if (pendingSpareChanges.size > 0 || spareSaveTimer) {
    await flushSpareChanges();
    return;
  }

  if (immediateSaveQueue.length > 0 && !isImmediateSaveRunning) {
    const queuedRequests = clonePendingRequests(immediateSaveQueue);
    immediateSaveQueue = [];
    immediateSaveQueued = false;
    await runImmediateSaveRequests(queuedRequests);
  }
}

function isModalVisible(id) {
  const modal = document.getElementById(id);
  return !!(modal && modal.classList.contains("show"));
}

async function handleBackgroundReturnAfterSave() {
  if (!wentBackgroundWhileSaving || isBackgroundSaveRecoveryRunning) return;

  const hasWorkOnReturn = isAnySaveRunningNow() || hasPendingSaveWork() || typeof pendingUpdateAction === "function";
  if (!hasWorkOnReturn) {
    wentBackgroundWhileSaving = false;
    return;
  }

  isBackgroundSaveRecoveryRunning = true;
  wentBackgroundWhileSaving = false;
  openBlockingLoadingModal("保存確認中", "保存中の変更を確認しています。");

  try {
    // 復帰時点で通信中の保存がある場合は、先に画面をロックして完了を待つ。
    // 完了後に未送信キューや更新失敗が残っていれば、同じ requestId のまま再処理する。
    while (isAnySaveRunningNow()) {
      await wait(250);
    }

    if (hasPendingSaveWork() || typeof pendingUpdateAction === "function") {
      await retryPendingWorkAfterBackground();

      while (isAnySaveRunningNow()) {
        await wait(250);
      }
    }

    if (isModalVisible("conflictModal") && !isConflictReloading) {
      await loadLatestFromConflict();
      return;
    }

    if (!isModalVisible("updateRetryModal")) {
      closeBlockingLoadingModal();
    }
  } catch (error) {
    console.error(error);
    closeBlockingLoadingModal();

    isBackgroundSaveRecoveryRunning = false;
    if (typeof pendingUpdateAction === "function") {
      openUpdateRetryModal(error && error.code ? error.code : "N01", { forceShow: true });
    } else {
      openLoadFailureModal("リストを読み込めませんでした。\n通信状況を確認してください。");
    }
    return;
  } finally {
    isBackgroundSaveRecoveryRunning = false;
  }
}

function setupBackgroundSaveRecovery() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      rememberBackgroundSaveState();
      return;
    }

    scheduleBackgroundReturnCheck();
  });

  window.addEventListener("pagehide", rememberBackgroundSaveState);
  window.addEventListener("pageshow", () => scheduleBackgroundReturnCheck());
}

function returnToTitleFromLoadFailure() {
  closeLoadFailureModal();
  resetModesAndSelections();
  showTitleScreen({ showStartButton: true });
}

function startFromTitleScreen() {
  const startButton = document.getElementById("startupStartButton");
  if (startButton) {
    startButton.classList.remove("show");
  }

  startStartupToastTimer();
  loadItems();
}

function retryLoadFromFailure() {
  closeLoadFailureModal();
  loadItems();
}

document.addEventListener("click", event => {
  if (!event.target.closest("#categoryPicker") && isCategoryPickerOpen) {
    closeCategoryPicker();
  }

  if (!event.target.closest("#ownerPicker") && isOwnerPickerOpen) {
    closeOwnerPicker();
  }

  if (event.target.closest("#itemModal")) return;
  if (event.target.closest("#deleteConfirmModal")) return;
  if (event.target.closest("#purchaseConfirmModal")) return;
  if (event.target.closest("#homeCancelConfirmModal")) return;
  if (event.target.closest("#updateRetryModal")) return;
  if (event.target.closest("#conflictModal")) return;
  if (event.target.closest("#loadFailureModal")) return;

  if (event.target.closest("#toast")) return;
  if (event.target.closest("[data-action]")) return;

  hideToast();

  if (swipedItemId && !event.target.closest(".swipe-action-button")) {
    closeSwipedItem();
  }
});

setupSafeActionHandlers();
setupStartupScreen();
startStartupToastTimer();
setupPullToRefresh();
setupSwipeCloseGuards();
setupBackgroundSaveRecovery();
loadItems();

// ========================================
// 初期化
// ========================================
if ("serviceWorker" in navigator) {
  let serviceWorkerRefreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (serviceWorkerRefreshing) return;
    serviceWorkerRefreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.register("./sw.js").then(registration => {
    if (registration && typeof registration.update === "function") {
      registration.update().catch(error => console.warn("Service Worker update failed", error));
    }
  }).catch(error => {
    console.warn("Service Worker registration failed", error);
  });
}
