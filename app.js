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

// Survey configuration for different categories
const SURVEY_CONFIG = {
    design: {
        type: "textarea",
        question: "Подробно опишите задачу",
        hint: "Ваше название, род деятельности, ЦА и другие ваши пожелания",
        placeholder: "Просим описать задачу максимально подробно, от этого зависит качество работы",
        maxLength: 2000
    },

    production: {
        type: "buttons",
        questions: [
            {
                question: "Подсветка",
                answers: [
                    { text: "Без подсветки", price: 0 },
                    { text: "Спереди", price: 0 },
                    { text: "Сзади", price: 100 }
                ]
            },
            {
                question: "Монтаж",
                answers: [
                    { text: "Самостоятельно", price: 0 },
                    { text: "Нужен монтаж", price: 200 }
                ]
            },
            {
                question: "Адрес",
                answers: [
                    { text: "Москва", price: 0 },
                    { text: "МО", price: 100 },
                    { text: "Другие регионы", price: 200 }
                ]
            }
        ]
    },

    documents: {
        type: "textarea",
        question: "Подробно опишите задачу",
        hint: "Временно не заполнено",
        placeholder: "Опишите задачу",
        maxLength: 2000
    }
};

let state = {
    screen: 'catalog', // catalog, cart, account, about
    activeCategory: null,
    cart: [], // each item: { id, title, basePrice, finalPrice, category, surveyAnswers: [] }
    modalMode: null,      // 'survey' | 'product' | null
    modalItemId: null,    // which item is currently being edited in survey
    productionSurvey: {}, // temporary storage for production survey before adding to cart
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
        return sum + (item.finalPrice || 0);
    }, 0);
    return itemsTotal;
}

// Survey helper functions
function getSurveyConfigForProduct(productId) {
    const category = getProductCategory(productId);
    return SURVEY_CONFIG[category] || null;
}

function isSurveyRequiredForProduct(productId) {
    const category = getProductCategory(productId);
    return category === 'production'; // Only production requires survey before adding to cart
}

function isSurveyCompleteForCartItem(item) {
    if (!item.surveyAnswers || item.surveyAnswers.length === 0) {
        return item.category !== 'design' && item.category !== 'documents'; // These categories require survey
    }

    // For textarea surveys, check if there's text
    if (item.category === 'design' || item.category === 'documents') {
        return item.surveyAnswers.some(answer => answer.answer && answer.answer.trim().length > 0);
    }

    // For button surveys, check if all questions are answered
    const config = SURVEY_CONFIG[item.category];
    if (config && config.type === 'buttons') {
        return item.surveyAnswers.length === config.questions.length;
    }

    return true;
}

function addProductToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const category = getProductCategory(productId);
    const basePrice = parseFloat(product.price) || 0;

    // Check if already in cart
    const existingItemIndex = state.cart.findIndex(item => item.id === productId);
    if (existingItemIndex >= 0) {
        // Update existing item
        const existingItem = state.cart[existingItemIndex];
        existingItem.title = product.title; // Update title in case it changed
        existingItem.basePrice = basePrice;
        existingItem.finalPrice = basePrice; // Reset to base price, survey will modify if needed
        existingItem.category = category;
        // Keep existing surveyAnswers
        saveCart();
        return existingItem;
    }

    // Add new item
    const newItem = {
        id: product.id,
        title: product.title,
        basePrice: basePrice,
        finalPrice: basePrice,
        category: category,
        surveyAnswers: []
    };

    console.log('addProductToCart: adding new item', newItem);
    state.cart.push(newItem);
    saveCart();
    console.log('addProductToCart: cart saved', state.cart);
    return newItem;
}

function removeProductFromCart(productId) {
    state.cart = state.cart.filter(i => i.id !== productId);
}

function getProductBasePrice(productId) {
    const product = products.find(p => p.id === productId);
    return product ? parseFloat(product.price) || 0 : 0;
}

function getProductCategory(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return null;

    // Determine category based on product categories
    if (product.categories.includes('design')) return 'design';
    if (product.categories.includes('production')) return 'production';
    if (product.categories.includes('documents')) return 'documents';
    return null;
}

function updateCartItemPrice(itemId, extraPrice) {
    const item = state.cart.find(i => i.id === itemId);
    if (item) {
        item.finalPrice = item.basePrice + extraPrice;
        saveCart();
        renderCart();
    }
}

function updateCartItemSurvey(itemId, surveyAnswers) {
    const item = state.cart.find(i => i.id === itemId);
    if (item) {
        item.surveyAnswers = surveyAnswers;
        saveCart();
        renderCart();
    }
}

// --- cart persistence helpers (localStorage) ---
function loadCart() {
    try {
        const raw = localStorage.getItem('cart');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                // Migrate old format to new format
                state.cart = parsed.map(item => {
                    const category = getProductCategory(item.id);
                    const basePrice = parseFloat(item.price || item.basePrice) || 0;
                    const finalPrice = parseFloat(item.finalPrice) || basePrice;
                    return {
                        id: item.id,
                        title: item.title,
                        basePrice: basePrice,
                        finalPrice: finalPrice,
                        category: category,
                        surveyAnswers: item.surveyAnswers || []
                    };
                });
            } else {
                state.cart = [];
            }
        }
    } catch (e) {
        console.error('Ошибка чтения корзины из localStorage:', e);
        state.cart = [];
    }
}

function saveCart() {
    try {
        console.log('saveCart: saving', state.cart);
        localStorage.setItem('cart', JSON.stringify(state.cart));
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

    if (isSurveyRequiredForProduct(product.id)) {
        // For production items, show survey first
        openProductionSurveyModal(product);
    } else {
        // For other items, show product details
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
}

function openProductionSurveyModal(product) {
    state.modalMode = 'production-survey';
    state.modalItemId = product.id;

    const overlay = $('#modal-overlay');
    const content = $('#modal-content');
    const config = getSurveyConfigForProduct(product.id);

    if (!config || config.type !== 'buttons') {
        console.error('Invalid survey config for production item');
        return;
    }

    // Initialize survey state
    state.productionSurvey = {
        productId: product.id,
        currentQuestion: 0,
        answers: [],
        totalExtraPrice: 0
    };

    renderProductionSurveyQuestion();
    overlay.classList.remove('hidden');
}

function renderProductionSurveyQuestion() {
    const content = $('#modal-content');
    const survey = state.productionSurvey;
    const product = products.find(p => p.id === survey.productId);
    const config = getSurveyConfigForProduct(survey.productId);
    const question = config.questions[survey.currentQuestion];

    content.innerHTML = `
        <div class="production-survey-modal">
            <div class="survey-progress">
                Вопрос ${survey.currentQuestion + 1} из ${config.questions.length}
            </div>
            <h2>${product.title}</h2>
            <div class="survey-question">
                <div class="question-text">${question.question}</div>
                <div class="answer-buttons">
                    ${question.answers.map((answer, index) => `
                        <button class="answer-btn" data-index="${index}" data-price="${answer.price}">
                            ${answer.text}${answer.price > 0 ? ` (+${answer.price}₽)` : ''}
                        </button>
                    `).join('')}
                </div>
            </div>
            <div class="survey-footer">
                ${survey.currentQuestion > 0 ? '<button id="prev-question">Назад</button>' : ''}
                <div class="price-info">
                    Итого: ${(parseFloat(product.price) + survey.totalExtraPrice)}₽
                </div>
            </div>
        </div>
    `;

    // Add event listeners
    content.querySelectorAll('.answer-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            const price = parseInt(e.target.dataset.price) || 0;
            selectProductionSurveyAnswer(index, price);
        });
    });

    if (content.querySelector('#prev-question')) {
        content.querySelector('#prev-question').addEventListener('click', goToPreviousQuestion);
    }
}

function selectProductionSurveyAnswer(answerIndex, extraPrice) {
    const survey = state.productionSurvey;
    const config = getSurveyConfigForProduct(survey.productId);
    const question = config.questions[survey.currentQuestion];
    const answer = question.answers[answerIndex];

    // Save answer
    survey.answers[survey.currentQuestion] = {
        question: question.question,
        answer: answer.text,
        extraPrice: extraPrice
    };

    // Update total price
    survey.totalExtraPrice = survey.answers.reduce((sum, ans) => sum + (ans?.extraPrice || 0), 0);

    // Move to next question or finish
    if (survey.currentQuestion < config.questions.length - 1) {
        survey.currentQuestion++;
        renderProductionSurveyQuestion();
    } else {
        finishProductionSurvey();
    }
}

function goToPreviousQuestion() {
    const survey = state.productionSurvey;
    if (survey.currentQuestion > 0) {
        // Remove current answer
        survey.answers[survey.currentQuestion] = null;
        // Recalculate total price
        survey.totalExtraPrice = survey.answers.reduce((sum, ans) => sum + (ans?.extraPrice || 0), 0);
        // Go back
        survey.currentQuestion--;
        renderProductionSurveyQuestion();
    }
}

function finishProductionSurvey() {
    const survey = state.productionSurvey;
    const product = products.find(p => p.id === survey.productId);
    const finalPrice = parseFloat(product.price) + survey.totalExtraPrice;

    const content = $('#modal-content');
    content.innerHTML = `
        <div class="production-survey-modal">
            <div class="survey-progress">
                Опрос завершен
            </div>
            <h2>${product.title}</h2>
            <div class="survey-summary">
                <div class="final-price">
                    Итоговая цена: ${finalPrice}₽
                </div>
                <div class="survey-answers">
                    ${survey.answers.filter(ans => ans).map(ans => `
                        <div class="answer-summary">
                            <strong>${ans.question}:</strong> ${ans.answer}
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="survey-footer">
                <button id="prev-question">Назад</button>
                <button id="add-to-cart-final" class="primary-btn">Добавить в корзину</button>
            </div>
        </div>
    `;

    // Add event listeners
    content.querySelector('#prev-question').addEventListener('click', goToPreviousQuestion);
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

        // Check if survey is required and completed
        const surveyRequired = item.category === 'design' || item.category === 'documents';
        const surveyCompleted = isSurveyCompleteForCartItem(item);

        div.innerHTML = `
            <img src="${item.img || 'https://via.placeholder.com/130x97?text=No+Image'}" alt="${item.title}" />
            <div class="cart-item-info">
                <div class="cart-item-title">${item.title}</div>
                <div class="cart-item-price">${item.finalPrice} ₽</div>
                ${surveyRequired ? `
                    <button data-id="${item.id}" class="survey-btn ${surveyCompleted ? 'completed' : ''}">
                        ${surveyCompleted ? 'Опрос заполнен' : 'Заполнить опрос'}
                    </button>
                ` : ''}
            </div>
            <button data-id="${item.id}" class="remove-btn">✕</button>
        `;

        if (surveyRequired) {
            div.querySelector('.survey-btn').addEventListener('click', () => {
                openCartItemSurveyModal(item);
            });
        }

        div.querySelector('.remove-btn').addEventListener('click', () => {
            state.cart = state.cart.filter(i => i.id !== item.id);
            saveCart();
            renderCart();
        });

        list.appendChild(div);
    });

    // Info block
    const info = document.createElement('div');
    info.id = 'cart-info';
    info.style.textAlign = 'center';

    if (state.cart.length === 0) {
        info.innerHTML = 'Для заказа добавьте товар в корзину';
    } else {
        const allSurveysCompleted = state.cart.every(item => isSurveyCompleteForCartItem(item));
        if (allSurveysCompleted) {
            info.innerHTML = '<strong>Все опросы заполнены. Можно оформлять заказ.</strong>';
        } else {
            info.innerHTML = '<strong>Заполните все опросы для оформления заказа</strong>';
        }
    }

    content.appendChild(createBlock(info));

    // Show list and total only if there are items
    if (state.cart.length > 0) {
        content.appendChild(createBlock(list));

        // total display
        const totalDiv = document.createElement('div');
        totalDiv.id = 'cart-total';
        totalDiv.style.fontWeight = 'bold';
        totalDiv.textContent = `Итого: ${calculateTotal()} ₽`;
        content.appendChild(createBlock(totalDiv));

        // Contract block
        const contractContainer = document.createElement('div');
        contractContainer.id = 'cart-contract';

        const allSurveysCompleted = state.cart.every(item => isSurveyCompleteForCartItem(item));
        const contract = document.createElement('div');
        contract.innerHTML = `
            <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <input type="checkbox" id="agree">
                Я согласен с условиями
            </label>
            <button id="pay-button" disabled>
                Оплатить заказ
            </button>
        `;
        contractContainer.appendChild(contract);
        content.appendChild(createBlock(contractContainer));

        // Enable/disable pay button based on surveys and agreement
        const payBtn = contract.querySelector('#pay-button');
        const agreeCheckbox = contract.querySelector('#agree');

        function updatePayButton() {
            const surveysComplete = state.cart.every(item => isSurveyCompleteForCartItem(item));
            const agreed = agreeCheckbox.checked;
            payBtn.disabled = !surveysComplete || !agreed;
        }

        agreeCheckbox.addEventListener('change', updatePayButton);
        updatePayButton(); // Initial check
    }
}

function openCartItemSurveyModal(item) {
    state.modalMode = 'cart-survey';
    state.modalItemId = item.id;

    const overlay = $('#modal-overlay');
    const content = $('#modal-content');
    const config = getSurveyConfigForProduct(item.id);

    if (!config) {
        console.error('No survey config for item', item.id);
        return;
    }

    content.innerHTML = `
        <div class="cart-survey-modal">
            <h2>Опрос: ${item.title}</h2>
            ${config.type === 'textarea' ? `
                <div class="survey-section">
                    <div class="question-text">${config.question}</div>
                    ${config.hint ? `<div class="question-hint" style="color: #636363; font-size: 0.9rem; margin-bottom: 8px;">${config.hint}</div>` : ''}
                    <textarea id="survey-textarea" class="survey-textarea" maxlength="${config.maxLength}" placeholder="${config.placeholder}">${item.surveyAnswers[0]?.answer || ''}</textarea>
                    <div class="char-counter" style="font-size: 0.8rem; color: #636363; text-align: right; margin-top: 4px;">
                        <span id="char-count">${(item.surveyAnswers[0]?.answer || '').length}</span>/${config.maxLength}
                    </div>
                </div>
            ` : ''}
            <div class="survey-footer">
                <button id="save-cart-survey" class="survey-save-btn">Сохранить</button>
            </div>
        </div>
    `;

    // Add character counter for textarea
    if (config.type === 'textarea') {
        const textarea = content.querySelector('#survey-textarea');
        const counter = content.querySelector('#char-count');

        textarea.addEventListener('input', () => {
            counter.textContent = textarea.value.length;
        });
    }

    content.querySelector('#save-cart-survey').addEventListener('click', () => {
        saveCartItemSurvey(item.id);
        closeModal({ save: false });
    });

    overlay.classList.remove('hidden');
}

function saveCartItemSurvey(itemId) {
    const item = state.cart.find(i => i.id === itemId);
    if (!item) return;

    const config = getSurveyConfigForProduct(itemId);
    if (!config) return;

    if (config.type === 'textarea') {
        const textarea = document.querySelector('#survey-textarea');
        if (textarea) {
            const answer = textarea.value.trim();
            item.surveyAnswers = [{
                question: config.question,
                answer: answer
            }];
            updateCartItemSurvey(itemId, item.surveyAnswers);
        }
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

    // Order status block
    const orderStatusBlock = document.createElement('div');
    orderStatusBlock.className = 'profile-card';
    orderStatusBlock.innerHTML = `
        <div class="profile-card-title">
            Статус заказа
        </div>
        <div id="order-status-content">
            Загрузка...
        </div>
    `;
    content.appendChild(createBlock(orderStatusBlock));

    // Load order status
    loadOrderStatus();
}

async function loadOrderStatus() {
    const tg = window.Telegram?.WebApp;
    const user = tg?.initDataUnsafe?.user;

    if (!user) {
        document.getElementById("order-status-content").innerText = "Не удалось получить данные пользователя";
        return;
    }

    try {
        const res = await fetch(`/api/order-status?telegramId=${user.id}`);
        const data = await res.json();

        const container = document.getElementById("order-status-content");

        if (!data.hasOrder) {
            container.innerHTML = "У вас нет активных заказов";
            return;
        }

        container.innerHTML = `
            <span class="status-pill">
                ${data.status}
            </span>
        `;

    } catch (err) {
        console.error('Error loading order status:', err);
        document.getElementById("order-status-content").innerText = "Не удалось загрузить статус";
    }
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
// Handle add to cart button in modal
on(document, 'click', '#add-to-cart', e => {
    console.log('ADD TO CART CLICKED');
    e.preventDefault();
    e.stopPropagation();

    const button = e.target.closest('#add-to-cart');
    console.log('BUTTON:', button);
    if (!button) return;

    const productId = Number(button.dataset.id);
    console.log('PRODUCT ID:', productId);
    if (!productId) return;

    console.log('CART BEFORE:', state.cart);
    addProductToCart(productId);
    console.log('CART AFTER:', state.cart);

    closeModal({ save: false });

    const product = products.find(p => p.id === productId);
    console.log('FOUND PRODUCT:', product);
    if (product) {
        alert(`${product.title} добавлен в корзину!`);
        switchScreen('cart');
    }
});
// Handle add to cart final button in production survey
on(document, 'click', '#add-to-cart-final', e => {
    e.preventDefault();
    e.stopPropagation();

    const survey = state.productionSurvey;
    const product = products.find(p => p.id === survey.productId);
    const finalPrice = parseFloat(product.price) + survey.totalExtraPrice;

    // Add to cart with survey answers using the proper function
    const cartItem = addProductToCart(product.id);
    if (cartItem) {
        // Update the item with survey answers and final price
        cartItem.finalPrice = finalPrice;
        cartItem.surveyAnswers = survey.answers.filter(ans => ans);
        saveCart();
    }

    // Close modal and show success
    closeModal({ save: false });
    alert(`${product.title} добавлен в корзину!`);

    // Switch to cart view
    switchScreen('cart');
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

        // Build survey answers from cart items
        const surveyAnswers = [];
        cartItems.forEach(item => {
            if (item.surveyAnswers && item.surveyAnswers.length > 0) {
                item.surveyAnswers.forEach(answer => {
                    surveyAnswers.push({
                        product: item.title,
                        question: answer.question,
                        answer: answer.answer
                    });
                });
            }
        });

        console.log('Sending order data:', {
            telegramId,
            name,
            username,
            cartItems,
            surveyAnswers,
            totalPrice,
        });

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
                surveyAnswers,
                totalPrice,
            }),
        });

        const result = await response.json();

        console.log('API response:', result);

        if (!response.ok) {
            // Build detailed error message
            let errorMsg = result.error || 'Failed to create order';
            if (result.details) {
                if (typeof result.details === 'object') {
                    errorMsg += ` – ${JSON.stringify(result.details).substring(0, 100)}`;
                } else {
                    errorMsg += ` – ${result.details}`;
                }
            }
            throw new Error(errorMsg);
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