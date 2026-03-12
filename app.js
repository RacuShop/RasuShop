// Telegram WebApp initialization
const tg = (typeof window !== 'undefined' && window.Telegram) ? window.Telegram.WebApp : null;

function applyThemeOverride() {
    // Telegram WebApp can inject its own theme styles. We keep our design stable by forcing
    // the colors we use (via CSS vars) and adding an important override stylesheet.
    const existing = document.getElementById('tg-theme-override');
    if (existing) return;

    const style = document.createElement('style');
    style.id = 'tg-theme-override';
    style.textContent = `
        body {
            background: var(--color-background) !important;
            color: var(--color-text) !important;
        }
        #app-header, #bottom-nav {
            background: var(--color-primary) !important;
            color: var(--color-text) !important;
        }
    `;
    document.head.appendChild(style);
}

// Telegram user metadata (from the WebApp init data)
const telegramUser = tg?.initDataUnsafe?.user || null;

// data structures
const categories = [
    { id: 'all', name: 'Все' },
    { id: 'design', name: 'Дизайн' },
    { id: 'production', name: 'Производство' },
    { id: 'documents', name: 'Документы' },
];
const products = [
    { id: 1, title: 'Экспресс-дизайн', categories: ['all','design'], price: '100', img: 'https://i.postimg.cc/zDgGfv7r/No-Img.jpg', desc: 'Описание товара 1' },
    { id: 2, title: 'Отрисовка логотипа', categories: ['all','design'], price: '200', img: 'https://i.postimg.cc/zDgGfv7r/No-Img.jpg', desc: 'Описание товара 2' },
    { id: 3, title: 'Вывеска', categories: ['all','production'], price: '300', img: 'https://i.postimg.cc/xdG8xfDF/Signboard.jpg', desc: 'Описание товара 3' },
    { id: 4, title: 'Короб', categories: ['all','production'], price: '400', img: 'https://i.postimg.cc/zDgGfv7r/No-Img.jpg', desc: 'Описание товара 4' },
    { id: 5, title: 'Товар 5', categories: ['all','documents'], price: '500', img: 'https://i.postimg.cc/zDgGfv7r/No-Img.jpg', desc: 'Описание товара 5' },
    { id: 6, title: 'Товар 6', categories: ['all','documents'], price: '600', img: 'https://i.postimg.cc/zDgGfv7r/No-Img.jpg', desc: 'Описание товара 6' },
];

// Survey templates let you customize which question blocks appear per item.
// You can add/remove blocks or create new templates for new products.
const surveyTemplates = {
    // special case: "Вывеска" имеет дополнительные вопросы and pricing logic
    'Вывеска': {
        fields: ['vectorFile', 'lightType', 'address', 'delivery'],
    },
    // default template: just a free-form notes field + delivery selection
    default: {
        fields: ['address', 'delivery'],
    },
};

let state = {
    screen: 'catalog', // catalog, cart, account, about
    activeCategory: null,
    cart: [],
    surveys: {},          // per-item survey answers
    deliveryPrice: 0,     // global delivery fee (from survey selection)
    modalMode: null,      // 'survey' | 'product' | null
    modalItemId: null,    // which item is currently being edited in survey
};

// helpers
function $(selector) {
    return document.querySelector(selector);
}
function on(parent, event, selector, handler) {
    parent.addEventListener(event, e => {
        if (e.target.closest(selector)) handler(e);
    });
}

// Универсальная обёртка для блоков с адаптивными отступами
function createBlock(element) {
    const block = document.createElement('div');
    block.classList.add('content-block');
    block.appendChild(element);
    return block;
}

// calculate cart total including delivery
function calculateTotal() {
    const itemsTotal = state.cart.reduce((sum, item) => {
        const price = parseFloat(item.price) || 0;
        return sum + price;
    }, 0);
    const delivery = state.deliveryPrice || 0;
    return itemsTotal + delivery;
}

function getSurvey(itemId) {
    if (!state.surveys[itemId]) {
        state.surveys[itemId] = {
            vectorFile: null,      // 'yes' | 'no'
            lightType: 'none',     // 'none'|'front'|'back'
            address: '',
            delivery: state.deliveryPrice || 0,
            autoAddedExpress: false,
        };
    }
    return state.surveys[itemId];
}

function ensureProductInCart(productId) {
    const exists = state.cart.some(i => i.id === productId);
    if (!exists) {
        const product = products.find(p => p.id === productId);
        if (product) state.cart.push({ ...product });
    }
}

function removeProductFromCart(productId) {
    state.cart = state.cart.filter(i => i.id !== productId);
}

function getProductBasePrice(productId) {
    const product = products.find(p => p.id === productId);
    return product ? parseFloat(product.price) || 0 : 0;
}

// --- cart persistence helpers (localStorage) ---
// use browser localStorage so that the cart survives page reloads and
// closing the mini‑app. this works regardless of Telegram-specific APIs.
function loadCart() {
    try {
        const raw = localStorage.getItem('cart');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                // backwards compatibility: older versions stored only cart array
                state.cart = parsed;
            } else if (parsed && typeof parsed === 'object') {
                state.cart = parsed.cart || [];
                state.surveys = parsed.surveys || {};
                state.deliveryPrice = parsed.deliveryPrice || 0;
            }
        }
    } catch (e) {
        console.error('Ошибка чтения корзины из localStorage:', e);
    }
}

function saveCart() {
    try {
        localStorage.setItem('cart', JSON.stringify({
            cart: state.cart,
            surveys: state.surveys,
            deliveryPrice: state.deliveryPrice,
        }));
    } catch (e) {
        console.error('Ошибка записи корзины в localStorage:', e);
    }
}

// render functions
function renderCategoryFilter() {
    const container = $('#category-filter');
    container.innerHTML = '';

    // add category buttons (including "all" itself)
    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.textContent = cat.name;
        btn.dataset.id = cat.id;
        if (state.activeCategory === cat.id) btn.classList.add('active');
        btn.addEventListener('click', () => {
            state.activeCategory = cat.id;
            renderCatalog();
            renderCategoryFilter();
        });
        container.appendChild(btn);
    });
}

function renderCatalog() {
    const content = $('#content');
    content.innerHTML = '';
    const grid = document.createElement('div');
    grid.id = 'catalog';

    const filtered = state.activeCategory === 'all'
        ? products
        : products.filter(p => p.categories && p.categories.includes(state.activeCategory));
    filtered.forEach(p => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <img src="${p.img}" alt="${p.title}" />
            <div class="card-body">
                <div class="card-header">
                    <div>
                        <div class="card-title">${p.title}</div>
                        <div class="card-price">${p.price} ₽</div>
                    </div>
                    <button data-id="${p.id}" class="details-btn">
  <svg id="a" data-name=" Слой 2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25">
  <path d="M8.47,20.3c-.23-.1-.48-.15-.74-.15-1.06,0-1.91.86-1.91,1.91s.86,1.91,1.91,1.91c.26,0,.52-.05.74-.15.69-.29,1.17-.97,1.17-1.76s-.48-1.47-1.17-1.76Z"/>
  <path d="M18.86,23.12c.14-.2.24-.43.29-.68.03-.12.04-.25.04-.39s-.01-.26-.04-.39c-.05-.25-.15-.48-.29-.68-.14-.2-.31-.38-.52-.52-.3-.21-.67-.33-1.07-.33h0c-.26,0-.52.05-.74.15-.69.29-1.17.97-1.17,1.76s.48,1.47,1.17,1.76c.23.1.48.15.74.15h0c.4,0,.76-.12,1.07-.33.2-.14.38-.31.52-.52Z"/>
  <path d="M23.96,3.91H5.09l-.04-.33c-.17-1.45-1.39-2.53-2.85-2.54h-1.16v1.92h1.16c.49,0,.9.36.95.84l1.52,12.86c.17,1.45,1.39,2.53,2.84,2.53h12.63v-1.91H7.51c-.48,0-.89-.36-.95-.84l-.12-1.07h15.45l2.07-11.46ZM20.3,13.46H6.21l-.9-7.64h16.37l-1.38,7.64Z"/>
    </svg>
    </button>
                </div>
            </div>
        `;
        card.querySelector('.details-btn').addEventListener('click', () => openModal(p));
        grid.appendChild(card);
    });

    content.appendChild(grid);
}

function openModal(product) {
    const overlay = $('#modal-overlay');
    state.modalMode = 'product';
    state.modalItemId = null;

    const content = $('#modal-content');
    content.innerHTML = `
        <img src="${product.img}" alt="${product.title}" />
        <h2>${product.title}</h2>
        <p>${product.desc}</p>
        <p class="card-price">${product.price} ₽</p>
        <button id="add-to-cart" data-id="${product.id}">Добавить в корзину</button>
    `;
    overlay.classList.remove('hidden');
}

function closeModal({ save = true } = {}) {
    if (save && state.modalMode === 'survey' && state.modalItemId != null) {
        saveSurveyFromModal();
    }
    state.modalMode = null;
    state.modalItemId = null;
    $('#modal-overlay').classList.add('hidden');
}

// Collect survey answers in readable format
function collectSurveyData() {
    const surveyObject = {};

    // Collect data from survey question containers
    document.querySelectorAll('[data-survey-question]').forEach(questionContainer => {
        const questionText = questionContainer.getAttribute('data-survey-question');

        // Look for checked radio button
        const checkedRadio = questionContainer.querySelector('input[type="radio"]:checked');
        if (checkedRadio) {
            const label = checkedRadio.closest('label');
            const answerText = label ? label.innerText.trim() : checkedRadio.value;
            surveyObject[questionText] = answerText;
            return;
        }

        // Look for text input or textarea
        const textarea = questionContainer.querySelector('textarea');
        if (textarea) {
            surveyObject[questionText] = textarea.value.trim();
            return;
        }

        const textInput = questionContainer.querySelector('input[type="text"]');
        if (textInput) {
            surveyObject[questionText] = textInput.value.trim();
            return;
        }
    });

    // Collect static survey text blocks
    document.querySelectorAll('[data-survey-text]').forEach(blockContainer => {
        const key = blockContainer.getAttribute('data-survey-text-label') || 'Тип заказа';
        const text = blockContainer.getAttribute('data-survey-text');
        surveyObject[key] = text;
    });

    return surveyObject;
}

function openSurveyModal(item) {
    state.modalMode = 'survey';
    state.modalItemId = item.id;

    const survey = getSurvey(item.id);
    const overlay = $('#modal-overlay');
    const content = $('#modal-content');

    const template = surveyTemplates[item.title] || surveyTemplates.default;

    const buildRadioGroup = (name, options, selectedValue) => {
        const items = options.map(opt => {
            const checked = String(opt.value) === String(selectedValue) ? 'checked' : '';
            return `
                <label class="survey-radio-item">
                    <input type="radio" name="${name}" value="${opt.value}" ${checked} />
                    <span>${opt.label}</span>
                </label>`;
        }).join('');
        return `<div class="survey-radio-group">${items}</div>`;
    };

    const deliveryOptions = [
        { label: 'Москва — 100 ₽', value: 100 },
        { label: 'МО — 200 ₽', value: 200 },
        { label: 'Другие регионы — 300 ₽', value: 300 },
    ];

    content.innerHTML = `
        <div class="survey-modal">
            <h2>Опрос: ${item.title}</h2>
            ${template.fields.includes('vectorFile') ? `
                <div class="survey-section" data-survey-question="Есть ли векторный файл?">
                    <div><strong>Есть ли векторный файл?</strong></div>
                    ${buildRadioGroup('survey-vector', [
                        { label: 'Да', value: 'yes' },
                        { label: 'Нет (добавить разработку дизайна)', value: 'no' },
                    ], survey.vectorFile)}
                </div>
                <div class="survey-section" data-survey-question="Тип подсветки">
                    <div><strong>Тип подсветки?</strong></div>
                    ${buildRadioGroup('survey-light', [
                        { label: 'Без подсветки', value: 'none' },
                        { label: 'Спереди', value: 'front' },
                        { label: 'Сзади +100₽', value: 'back' },
                    ], survey.lightType)}
                </div>
                <div class="survey-section" data-survey-question="Адрес места установки">
                    <div><strong>Напишите адрес места установки:</strong></div>
                    <textarea id="survey-address" class="survey-textarea" maxlength="2000" placeholder="Введите адрес...">${survey.address || ''}</textarea>
                </div>
            ` : `
                <div class="survey-section" data-survey-question="Комментарии по заказу">
                    <div><strong>Комментарии по заказу</strong></div>
                    <textarea id="survey-address" class="survey-textarea" maxlength="2000" placeholder="Введите дополнительные детали...">${survey.address || ''}</textarea>
                </div>
            `}
            <div class="survey-section" data-survey-question="Выберите доставку">
                <div><strong>Выберите доставку:</strong></div>
                ${buildRadioGroup('survey-delivery', deliveryOptions, survey.delivery || state.deliveryPrice || 0)}
            </div>
            <div class="survey-footer">
                <button id="save-survey" class="survey-save-btn">Сохранить информацию</button>
            </div>
            <div class="survey-close-note">При закрытии окно сохраняется автоматически.</div>
        </div>
    `;

    // ensure inputs scroll into view on mobile when focused
    content.querySelectorAll('input, textarea').forEach(el => {
        el.addEventListener('focus', () => {
            setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
        });
    });

    content.querySelector('#save-survey')?.addEventListener('click', () => {
        saveSurveyFromModal();
        closeModal({ save: false });
    });

    overlay.classList.remove('hidden');
}

function saveSurveyFromModal() {
    if (state.modalMode !== 'survey' || state.modalItemId == null) return;
    const itemId = state.modalItemId;
    const item = state.cart.find(i => i.id === itemId);
    if (!item) return;

    const survey = getSurvey(itemId);

    const vector = document.querySelector('input[name="survey-vector"]:checked')?.value;
    const light = document.querySelector('input[name="survey-light"]:checked')?.value;
    const address = document.getElementById('survey-address')?.value || '';
    const delivery = document.querySelector('input[name="survey-delivery"]:checked')?.value;

    if (vector) survey.vectorFile = vector;
    if (light) survey.lightType = light;
    survey.address = address.slice(0, 2000);

    if (delivery) {
        survey.delivery = parseFloat(delivery) || 0;
        state.deliveryPrice = survey.delivery;
    }

    // special logic for "Вывеска"
    if (item.title === 'Вывеска') {
        if (survey.vectorFile === 'no') {
            ensureProductInCart(1);
            survey.autoAddedExpress = true;
        } else if (survey.vectorFile === 'yes' && survey.autoAddedExpress) {
            removeProductFromCart(1);
            survey.autoAddedExpress = false;
        }

        const base = getProductBasePrice(itemId);
        const extra = survey.lightType === 'back' ? 100 : 0;
        item.price = base + extra;
    }

    saveCart();
    renderCart();
}

function renderBottomNav() {
    document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.screen === state.screen);
    });
}

function renderCart() {
    const content = $('#content');
    content.innerHTML = '';

    const list = document.createElement('div');
    list.id = 'cart-list';

    state.cart.forEach(item => {
        const div = document.createElement('div');
        div.className = 'cart-item';

        div.innerHTML = `
            <img src="${item.img}" alt="${item.title}" />
            <div class="cart-item-info">
                <div class="cart-item-title">${item.title}</div>
                <div class="cart-item-price">${item.price} ₽</div>
                <button data-id="${item.id}" class="survey-btn">Опрос</button>
            </div>
            <button data-id="${item.id}" class="remove-btn">✕</button>
        `;

        div.querySelector('.survey-btn').addEventListener('click', () => {
            openSurveyModal(item);
        });

        div.querySelector('.remove-btn').addEventListener('click', () => {
            const survey = state.surveys[item.id];
            if (survey?.autoAddedExpress) {
                removeProductFromCart(1);
            }
            delete state.surveys[item.id];
            state.cart = state.cart.filter(i => i.id !== item.id);
            saveCart();
            renderCart(); // перерисовка после удаления
        });

        list.appendChild(div);
    });

    // === Единый информационный блок: текст зависит от состояния корзины ===
    const info = document.createElement('div');
    info.id = 'cart-info';
    info.style.textAlign = 'center';
    
    if (state.cart.length === 0) {
        info.innerHTML = 'Добавьте услуги в корзину, чтобы оформить заказ.';
    } else {
        info.innerHTML = '<strong>Для оформления заказа заполните опрос</strong>';
    }

    content.appendChild(createBlock(info));

    // Показываем список и итог только если есть товары
    if (state.cart.length > 0) {
        content.appendChild(createBlock(list));

        // total display
        const totalDiv = document.createElement('div');
        totalDiv.id = 'cart-total';
        totalDiv.style.fontWeight = 'bold';
        totalDiv.textContent = `Итого: ${calculateTotal()} ₽`;
        content.appendChild(createBlock(totalDiv));

        // === Блок "Договор" ===
        const contractContainer = document.createElement('div');
        contractContainer.id = 'cart-contract';

        const contract = document.createElement('div');
        contract.innerHTML = `
            <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <input type="checkbox" id="agree"> Я согласен
            </label>
            <button id="pay-button" disabled>
                Оплатить заказ
            </button>
        `;
        contractContainer.appendChild(contract);
        content.appendChild(createBlock(contractContainer));

        // Привязка чекбокса к кнопке
        const payBtn = contract.querySelector('#pay-button');
        const agreeCheckbox = contract.querySelector('#agree');
        agreeCheckbox.addEventListener('change', () => {
            payBtn.disabled = !agreeCheckbox.checked;
        });
    }
}


function renderAbout() {
    const content = $('#content');
    content.innerHTML = '<div id="about"><p>О проекте</p></div>';
}

function renderAccount() {
    const content = $('#content');
    content.innerHTML = '';

    const avatarUrl = telegramUser?.photo_url || 'https://via.placeholder.com/120?text=Аватар';
    const name = telegramUser?.first_name || 'Гость';
    const userId = telegramUser?.id ? `@${telegramUser.id}` : 'Не доступен';

    const accountCard = document.createElement('div');
    accountCard.className = 'account-card';
    accountCard.innerHTML = `
        <div class="account-top">
            <img id="user_avatar" class="account-avatar" src="${avatarUrl}" alt="Аватар" />
            <div class="account-meta">
                <div id="user_name" class="account-name">${name}</div>
                <div id="user_id" class="account-id">${userId}</div>
            </div>
        </div>
        <div class="account-note">
            Информация берётся из Telegram
        </div>
    `;
    content.appendChild(createBlock(accountCard));
}

function switchScreen(screen) {
    state.screen = screen;
    renderBottomNav();
    // only show filters on catalog screen
    const filterContainer = $('#category-filter');
    if (screen === 'catalog') {
        renderCategoryFilter();
        renderCatalog();
    } else {
        // clear filters when leaving catalog
        if (filterContainer) filterContainer.innerHTML = '';
        if (screen === 'cart') {
            renderCart();
        } else if (screen === 'account') {
            renderAccount();
        } else if (screen === 'about') {
            renderAbout();
        }
    }
}

// event listeners
on(document, 'click', '#modal-close', closeModal);
on(document, 'click', '#modal-overlay', e => {
    if (e.target.id === 'modal-overlay') closeModal();
});
on(document, 'click', '#modal button#add-to-cart', e => {
    const id = parseInt(e.target.dataset.id, 10);
    const product = products.find(p => p.id === id);
    if (product) {
        state.cart.push(product);
        saveCart();
        closeModal();
    }
});
on(document, 'click', '#bottom-nav .nav-btn', e => {
    const button = e.target.closest('.nav-btn');
    if (button && button.dataset.screen) {
        switchScreen(button.dataset.screen);
    }
});

// Добавляем обработчик клика на логотип для перехода в каталог
on(document, 'click', '#app-logo', () => {
    switchScreen('catalog');
});

// Payment button handler
on(document, 'click', '#pay-button', async (e) => {
    e.preventDefault();
    const payBtn = e.target;
    
    try {
        // Disable button and show loading state
        payBtn.disabled = true;
        const originalText = payBtn.textContent;
        payBtn.textContent = 'Отправка заказа...';

        // Collect data
        const cartItems = state.cart;
        const telegramId = telegramUser?.id;
        const name = telegramUser?.first_name || 'Guest';
        const username = telegramUser?.username || 'unknown';
        const totalPrice = calculateTotal();

        // Collect survey data in readable format
        const survey = collectSurveyData();

        // Send to API
        const response = await fetch('/api/create-order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                telegramId,
                name,
                username,
                cartItems,
                survey,
                totalPrice,
            }),
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to create order');
        }

        // Success
        console.log('Order created successfully:', result);
        alert('Спасибо! Ваш заказ принят. В ближайшее время с вами свяжется менеджер.');
        
        // Clear cart
        state.cart = [];
        state.surveys = {};
        state.deliveryPrice = 0;
        saveCart();
        
        // Return to catalog
        switchScreen('catalog');

    } catch (error) {
        console.error('Order submission error:', error);
        alert(`Ошибка: ${error.message}`);
        
        // Re-enable button
        const payBtn = $('#pay-button');
        if (payBtn) {
            payBtn.disabled = false;
            payBtn.textContent = 'Оплатить заказ';
        }
    }
});

// initialization
(() => {
    // restore cart immediately (localStorage API is synchronous)
    loadCart();
    if (!state.activeCategory) state.activeCategory = 'all';
    switchScreen(state.screen);
    // keep cart saved when user leaves
    window.addEventListener('beforeunload', saveCart);
})();