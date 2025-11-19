// ==UserScript==
// @name         Quizizz Bypass (Bahasa Indonesia)
// @version      50.0
// @description  Menyelesaikan soal Quizizz
// @author       mzzvxm
// @icon         https://tse1.mm.bing.net/th/id/OIP.Ydweh29BuHk_PGD4dGJXbAHaHa?rs=1&pid=ImgDetMain&o=7&rm=3
// @match        https://wayground.com/join/game/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // -----------------------------------------------------------------------------------
    // PENTING: DAFTAR KUNCI API
    // -----------------------------------------------------------------------------------
    const GEMINI_API_KEYS = [
        "CHAVE_GEMINI_1",   // Kunci 1
        "CHAVE_GEMINI_2",  // Kunci 2
        "CHAVE_GEMINI_3"  // Kunci 3
    ];
    // --- Integrasi OpenRouter/DeepSeek (v47) ---
    const OPENROUTER_API_KEYS = [
        "SUA_CHAVE_OPENROUTER_1",
        "SUA_CHAVE_OPENROUTER_2",
        "SUA_CHAVE_OPENROUTER_3"
    ];
    const DEEPSEEK_MODEL_NAME = "deepseek/deepseek-chat"; // Model DeepSeek
    let currentAiProvider = 'gemini'; // 'gemini' atau 'deepseek'
    // -----------------------------------------------------------------------------------

    let currentApiKeyIndex = 0;
    let currentOpenRouterKeyIndex = 0;
    let lastAiResponse = '';

    // --- DETEKSI ID KUIS (v46) ---
    const regexQuizId = /\/(?:quiz|quizzes|admin\/quiz|games|attempts|join)\/([a-f0-9]{24})/i;
    let quizIdDetected = null;
    let interceptorsStarted = false;
    // -----------------------------------

    // --- FUNGSI UTILITAS ---

    function waitForElement(selector, all = false, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const interval = setInterval(() => {
                const elements = all ? document.querySelectorAll(selector) : document.querySelector(selector);
                if ((all && elements.length > 0) || (!all && elements)) {
                    clearInterval(interval);
                    resolve(elements);
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(interval);
                    reject(new Error(`Elemen "${selector}" tidak ditemukan setelah ${timeout / 1000} detik.`));
                }
            }, 100);
        });
    }

    function waitForElementToDisappear(selector, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const interval = setInterval(() => {
                const element = document.querySelector(selector);
                if (!element) {
                    clearInterval(interval);
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(interval);
                    reject(new Error(`Elemen "${selector}" tidak menghilang setelah ${timeout / 1000} detik.`));
                }
            }, 100);
        });
    }

    // --- LOGIKA PEMECAH ---

    async function extrairDadosDaQuestao() {
    try {
        const questionTextElement = document.querySelector('#questionText');
        const questionText = questionTextElement ? questionTextElement.innerText.trim().replace(/\s+/g, ' ') : "Tidak dapat menemukan teks pertanyaan.";
        const questionImageElement = document.querySelector('img[data-testid="question-container-image"]');
        const questionImageUrl = questionImageElement ? questionImageElement.src : null;

        const extractText = (el) => {
            const mathElement = el.querySelector('annotation[encoding="application/x-tex"]');
            return mathElement ? mathElement.textContent.trim() : el.querySelector('#optionText')?.innerText.trim() || '';
        };

        const dropdownButtons = document.querySelectorAll('button.options-dropdown');
        if (dropdownButtons.length > 1) {
            console.log("Tipe Multiple Dropdown terdeteksi.");
            const dropdowns = [];
            let questionTextWithPlaceholders = questionTextElement.innerHTML;
            const popperSelector = '.v-popper__popper--shown';

            dropdownButtons.forEach((btn, i) => {
                const placeholder = ` [RESPOSTA ${i + 1}] `; // JANGAN UBAH KATA KUNCI INI (Digunakan untuk replace)
                const wrapper = btn.closest('.dropdown-wrapper');
                if (wrapper) {
                     questionTextWithPlaceholders = questionTextWithPlaceholders.replace(wrapper.outerHTML, placeholder);
                }
            });

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = questionTextWithPlaceholders;
            const cleanQuestionText = tempDiv.innerText.replace(/\s+/g, ' ');

            let allAvailableOptions = [];
            const firstBtn = dropdownButtons[0];
            firstBtn.click();
            try {
                const optionElements = await waitForElement(`${popperSelector} button.dropdown-option`, true, 2000);
                allAvailableOptions = Array.from(optionElements).map(el => el.innerText.trim());
                console.log("Pool opsi terdeteksi:", allAvailableOptions);
            } catch (e) {
                console.error("Gagal membaca pool opsi dari dropdown pertama.", e);
                if (document.querySelector(popperSelector)) document.body.click();
            }

            if (document.querySelector(popperSelector)) document.body.click();
            try {
                await waitForElementToDisappear(popperSelector, 2000);
            } catch (e) {
                console.warn("Popper tidak tertutup, tapi melanjutkan...");
            }

            dropdownButtons.forEach((btn, i) => {
                 dropdowns.push({
                    button: btn,
                    placeholder: `[RESPOSTA ${i + 1}]`
                });
            });

            console.log("Teks Bersih Dikirim ke AI:", cleanQuestionText);
            return { questionText: cleanQuestionText, questionImageUrl, questionType: 'multi_dropdown', dropdowns, allAvailableOptions };
        }

        if (dropdownButtons.length === 1) {
            return { questionText, questionImageUrl, questionType: 'dropdown', dropdownButton: dropdownButtons[0] };
        }

        const equationEditor = document.querySelector('div[data-cy="equation-editor"]');
        if (equationEditor) {
            return { questionText, questionImageUrl, questionType: 'equation' };
        }
        const droppableBlanks = document.querySelectorAll('button.droppable-blank');
        const dragOptions = document.querySelectorAll('.drag-option');
        if (droppableBlanks.length > 1 && dragOptions.length > 0) {
            const questionContainer = document.querySelector('.drag-drop-text > div');
            const dropZones = [];
            if (questionContainer) {
                const children = Array.from(questionContainer.children);
                for (let i = 0; i < children.length; i++) {
                    const blankButton = children[i].querySelector('button.droppable-blank');
                    if (blankButton) {
                        const precedingSpan = children[i - 1];
                        if (precedingSpan && precedingSpan.tagName === 'SPAN') {
                            let promptText = precedingSpan.innerText.trim().replace(/:\s*$/, '').replace(/\s+/g, ' ');
                            dropZones.push({ prompt: promptText, blankElement: blankButton });
                        }
                    }
                }
            }
            const draggableOptions = Array.from(dragOptions).map(el => ({ text: el.innerText.trim(), element: el }));
            return { questionText: questionContainer.innerText.trim(), questionImageUrl, questionType: 'multi_drag_into_blank', draggableOptions, dropZones };
        }
        if (droppableBlanks.length === 1 && dragOptions.length > 0) {
             const draggableOptions = Array.from(dragOptions).map(el => ({ text: el.querySelector('.dnd-option-text')?.innerText.trim() || '', element: el }));
            return { questionText, questionImageUrl, questionType: 'drag_into_blank', draggableOptions, dropZone: { element: droppableBlanks[0] } };
        }

        const matchContainer = document.querySelector('.match-order-options-container, .question-options-layout');
        if (matchContainer) {
            const draggableItemElements = Array.from(matchContainer.querySelectorAll('.match-order-option.is-option-tile'));
            const dropZoneElements = Array.from(matchContainer.querySelectorAll('.match-order-option.is-drop-tile'));

            const isImageMatch = draggableItemElements.length > 0 && (draggableItemElements[0].querySelector('.option-image') || draggableItemElements[0].dataset.type === 'image');

            if (isImageMatch) {
                console.log("Tipe Match-Order (Gambar ke Teks) terdeteksi.");
                const draggableItems = [];
                for (let i = 0; i < draggableItemElements.length; i++) {
                    const el = draggableItemElements[i];
                    const imgDiv = el.querySelector('.option-image');
                    const style = imgDiv ? window.getComputedStyle(imgDiv).backgroundImage : null;
                    const urlMatch = style ? style.match(/url\("(.+?)"\)/) : null;
                    let imageUrl = urlMatch ? urlMatch[1] : null;

                    if (!imageUrl) {
                        const dataCy = el.dataset.cy;
                        if (dataCy && dataCy.includes('url(')) {
                            const urlMatchCy = dataCy.match(/url\((.+)\)/);
                            if (urlMatchCy) imageUrl = urlMatchCy[1].replace(/\?w=\d+&h=\d+$/, '');
                        }
                    }

                    if (imageUrl) {
                        // Menggunakan "IMAGEM" sebagai ID agar konsisten dengan logic
                        draggableItems.push({ id: `IMAGEM ${i + 1}`, imageUrl, element: el });
                    }
                }

                const dropZones = dropZoneElements.map(el => ({ text: extractText(el), element: el }));

                return { questionText, questionImageUrl, questionType: 'match_image_to_text', draggableItems, dropZones };

            } else if (draggableItemElements.length > 0 && dropZoneElements.length > 0) {
                const draggableItems = draggableItemElements.map(el => ({ text: extractText(el), element: el }));
                const dropZones = dropZoneElements.map(el => ({ text: extractText(el), element: el }));

                const questionType = questionText.toLowerCase().includes('reorder') ? 'reorder' : 'match_order';
                return { questionText, questionImageUrl, questionType, draggableItems, dropZones };
            }
        }

        const openEndedTextarea = document.querySelector('textarea[data-cy="open-ended-textarea"]');
        if (openEndedTextarea) {
            return { questionText, questionImageUrl, questionType: 'open_ended', answerElement: openEndedTextarea };
        }
        const optionElements = document.querySelectorAll('.option.is-selectable');
        if (optionElements.length > 0) {
            const isMultipleChoice = Array.from(optionElements).some(el => el.classList.contains('is-msq'));
            const options = Array.from(optionElements).map(el => ({ text: extractText(el), element: el }));
            return { questionText, questionImageUrl, questionType: isMultipleChoice ? 'multiple_choice' : 'single_choice', options };
        }
        console.error("Tipe pertanyaan tidak dikenali.");
        return null;
    } catch (error) {
        console.error("Kesalahan saat mengekstrak data pertanyaan:", error);
        return null;
    }
}

    async function obterRespostaDaIA(quizData) {
        lastAiResponse = '';
        const viewResponseBtn = document.getElementById('view-raw-response-btn');
        if (viewResponseBtn) viewResponseBtn.style.display = 'none';

        // --- 1. Logika Prompt ---
        // CATATAN: Format '[RESPOSTA X]' dan '->' dijaga agar REGEX tetap bekerja.
        let promptDeInstrucao = "", formattedOptions = "";
        switch (quizData.questionType) {
            case 'multi_dropdown':
                promptDeInstrucao = `Ini adalah soal dengan banyak bagian kosong ([RESPOSTA X]). Opsi yang tersedia adalah pool bersama dan setiap opsi hanya bisa digunakan sekali. Tentukan jawaban yang benar untuk SETIAP placeholder. Jawab dengan setiap jawaban di baris baru, dalam format '[RESPOSTA X]: Jawaban Benar'. Jika placeholder tidak memiliki jawaban logis di pool (misal: di luar urutan), abaikan dari jawaban.`;
                formattedOptions = "Pool Opsi Tersedia: " + quizData.allAvailableOptions.join(', ');
                break;
            case 'match_image_to_text':
                promptDeInstrucao = `Ini adalah soal mencocokkan gambar dengan teks yang sesuai. Untuk setiap gambar, berikan pasangan yang benar dalam format TEPAT: 'Teks Opsi -> ID Gambar' (contoh: 90° -> IMAGEM 3), dengan setiap pasangan di baris baru.`;
                const dropZoneTexts = quizData.dropZones.map(item => `- "${item.text}"`).join('\n');
                formattedOptions = `Opsi Teks (Tempat Meletakkan):\n${dropZoneTexts}`;
                break;
            case 'match_order':
                promptDeInstrucao = `Jawab dengan pasangan dalam format TEPAT: 'Teks Tempat Meletakkan -> Teks Item yang Diseret', dengan setiap pasangan di baris baru.`;
                const draggables = quizData.draggableItems.map(item => `- "${item.text}"`).join('\n');
                const droppables = quizData.dropZones.map(item => `- "${item.text}"`).join('\n');
                formattedOptions = `Item untuk Diseret:\n${draggables}\n\nTempat Meletakkan:\n${droppables}`;
                break;
            case 'multi_drag_into_blank': promptDeInstrucao = `Ini adalah soal mencocokkan beberapa kalimat dengan ekspresi yang benar. Jawab dengan pasangan dalam format TEPAT: 'Kalimat pertanyaan -> Ekspresi opsi', dengan setiap pasangan di baris baru.`; const prompts = quizData.dropZones.map(item => `- "${item.prompt}"`).join('\n'); const options = quizData.draggableOptions.map(item => `- "${item.text}"`).join('\n'); formattedOptions = `Kalimat:\n${prompts}\n\nEkspresi (Opsi):\n${options}`; break;
            case 'equation': promptDeInstrucao = `Selesaikan persamaan atau pertidaksamaan berikut. Berikan HANYA ekspresi akhir yang disederhanakan (contoh: x = 5, atau y > 3).`; formattedOptions = `PERSAMAAN: "${quizData.questionText}"`; break;
            case 'dropdown': case 'single_choice': promptDeInstrucao = `Jawab HANYA dengan teks persis dari SATU alternatif yang benar.`; formattedOptions = "OPSI:\n" + quizData.options.map(opt => `- "${opt.text}"`).join('\n'); break;
            case 'reorder': promptDeInstrucao = `Tugasnya adalah: "${quizData.questionText}". Berikan urutan yang benar dengan mencantumkan teks item, satu per baris, dari awal hingga akhir.`; formattedOptions = "Item untuk diurutkan:\n" + quizData.draggableItems.map(item => `- "${item.text}"`).join('\n'); break;
            case 'drag_into_blank': promptDeInstrucao = `Jawab HANYA dengan teks dari SATU opsi yang benar yang mengisi bagian kosong.`; formattedOptions = "Opsi untuk diseret:\n" + quizData.draggableOptions.map(item => `- "${item.text}"`).join('\n'); break;
            case 'open_ended': promptDeInstrucao = `Jawab HANYA dengan kata atau frasa pendek yang mengisi bagian kosong.`; break;
            case 'multiple_choice': promptDeInstrucao = `Jawab HANYA dengan teks persis dari SEMUA alternatif yang benar, pisahkan setiap jawaban di BARIS BARU.`; formattedOptions = "OPSI:\n" + quizData.options.map(opt => `- "${opt.text}"`).join('\n'); break;
        }
        let textPrompt = `${promptDeInstrucao}\n\n---\nPERTANYAAN: "${quizData.questionText}"\n---\n${formattedOptions}`;

        // --- 2. Pemrosesan Gambar ---
        let base64Image = null;
        if (quizData.questionImageUrl) {
            base64Image = await imageUrlToBase64(quizData.questionImageUrl);
        }
        const hasDraggableImages = quizData.questionType === 'match_image_to_text';

        // Verifikasi Gambar DeepSeek
        if (currentAiProvider === 'deepseek' && (base64Image || hasDraggableImages)) {
            console.warn("DeepSeek tidak mendukung gambar. Menampilkan peringatan...");
            try {
                const acaoUsuario = await mostrarAvisoDeepSeekImagem();
                if (acaoUsuario === 'gemini') {
                    console.log("Pengguna memilih menggunakan Gemini.");
                    currentAiProvider = 'gemini';
                    const aiToggleBtn = document.getElementById('ai-toggle-btn');
                    if (aiToggleBtn) {
                        aiToggleBtn.innerText = 'AI: Gemini';
                        aiToggleBtn.style.color = 'rgba(255, 255, 255, 0.6)';
                    }
                } else if (acaoUsuario === 'sem_imagem') {
                    console.log("Pengguna memilih mengirim ke DeepSeek tanpa gambar.");
                    base64Image = null;
                    if (quizData.questionType === 'match_image_to_text') {
                        quizData.questionType = 'match_order'; // Downgrade
                        quizData.draggableItems = quizData.draggableItems.map(item => ({
                            text: item.id, // Menggunakan "IMAGEM 1" sebagai teks
                            element: item.element
                        }));
                        promptDeInstrucao = `Jawab dengan pasangan dalam format TEPAT: 'Teks Tempat Meletakkan -> ID Gambar' (contoh: 90° -> IMAGEM 3), dengan setiap pasangan di baris baru.`;
                        const draggables = quizData.draggableItems.map(item => `- "${item.text}"`).join('\n');
                        const droppables = quizData.dropZones.map(item => `- "${item.text}"`).join('\n');
                        formattedOptions = `Item untuk Diseret (ID):\n${draggables}\n\nTempat Meletakkan:\n${droppables}`;
                        textPrompt = `${promptDeInstrucao}\n\n---\nPERTANYAAN: "${quizData.questionText}"\n---\n${formattedOptions}`;
                    }
                }
            } catch (error) {
                console.error(error.message);
                throw error;
            }
        }

        // --- 3. Logika Fetch ---
        try {
            let aiResponseText = null;
            if (currentAiProvider === 'gemini') {
                console.log("Menggunakan Provider: Gemini");
                let geminiKeyFailed = false;
                for (let i = 0; i < GEMINI_API_KEYS.length; i++) {
                    const currentKey = GEMINI_API_KEYS[currentApiKeyIndex];
                    if (!currentKey || currentKey.includes("SUA_") || currentKey.length < 30) {
                        console.warn(`Kunci API Gemini #${currentApiKeyIndex + 1} sepertinya placeholder. Melewati...`);
                        currentApiKeyIndex = (currentApiKeyIndex + 1) % GEMINI_API_KEYS.length;
                        continue;
                    }
                    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${currentKey}`;

                    let promptParts = [{ text: textPrompt }];

                    if (base64Image) {
                        const [header, data] = base64Image.split(',');
                        let mimeType = header.match(/:(.*?);/)[1];
                        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) mimeType = 'image/jpeg';
                        promptParts.push({ inline_data: { mime_type: mimeType, data: data } });
                    }

                    if (quizData.questionType === 'match_image_to_text') {
                        promptParts.push({ text: "\n\nGAMBAR (Item untuk Diseret):\n" });
                        for (const item of quizData.draggableItems) {
                             const base64 = await imageUrlToBase64(item.imageUrl);
                             if (base64) {
                                const [header, data] = base64.split(',');
                                let mimeType = header.match(/:(.*?);/)[1];
                                if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) mimeType = 'image/jpeg';
                                promptParts.push({ inline_data: { mime_type: mimeType, data: data } });
                                promptParts.push({ text: `- ${item.id}` }); // Mengirim " - IMAGEM 1"
                             }
                        }
                    }

                    try {
                        const response = await fetchWithTimeout(API_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ contents: [{ parts: promptParts }] })
                        });
                        if (response.ok) {
                            const data = await response.json();
                            aiResponseText = data.candidates[0].content.parts[0].text;
                            console.log(`Sukses dengan Kunci API Gemini #${currentApiKeyIndex + 1}.`);
                            break;
                        }
                        const errorData = await response.json();
                        const errorMessage = errorData.error?.message || `Error ${response.status}`;
                        console.warn(`Kunci API Gemini #${currentApiKeyIndex + 1} gagal: ${errorMessage}. Mencoba berikutnya...`);
                        lastAiResponse = `Gagal di Kunci Gemini #${currentApiKeyIndex + 1}: ${errorMessage}`;
                    } catch (error) {
                        console.warn(`Error request dengan Kunci API Gemini #${currentApiKeyIndex + 1}: ${error.message}. Mencoba berikutnya...`);
                        lastAiResponse = `Gagal di Kunci Gemini #${currentApiKeyIndex + 1}: ${error.message}`;
                    }
                    currentApiKeyIndex = (currentApiKeyIndex + 1) % GEMINI_API_KEYS.length;
                    if (i === GEMINI_API_KEYS.length - 1) {
                         geminiKeyFailed = true;
                    }
                }
                if (!aiResponseText && geminiKeyFailed) {
                    throw new Error("Semua kunci API Gemini gagal.");
                }

            } else if (currentAiProvider === 'deepseek') {
                console.log("Menggunakan Provider: DeepSeek (via OpenRouter)");
                let deepseekKeyFailed = false;

                for (let i = 0; i < OPENROUTER_API_KEYS.length; i++) {
                    const currentKey = OPENROUTER_API_KEYS[currentOpenRouterKeyIndex];
                    if (!currentKey || currentKey.includes("SUA_") || currentKey.length < 30) {
                        console.warn(`Kunci OpenRouter #${currentOpenRouterKeyIndex + 1} sepertinya placeholder. Melewati...`);
                        currentOpenRouterKeyIndex = (currentOpenRouterKeyIndex + 1) % OPENROUTER_API_KEYS.length;
                        continue;
                    }

                    const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
                    const body = JSON.stringify({
                        model: DEEPSEEK_MODEL_NAME,
                        messages: [ { role: 'user', content: textPrompt } ],
                        max_tokens: 1024
                    });

                    try {
                        const response = await fetchWithTimeout(API_URL, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${currentKey}`,
                                'HTTP-Referer': 'https://github.com/mzzvxm',
                                'X-Title': 'Quizizz Bypass Script'
                            },
                            body: body
                        });

                        if (response.ok) {
                            const data = await response.json();
                            aiResponseText = data.choices[0].message.content;
                            console.log(`Sukses dengan Kunci OpenRouter #${currentOpenRouterKeyIndex + 1}.`);
                            break;
                        }

                        const errorData = await response.json();
                        const errorMessage = errorData.error?.message || `Error ${response.status}`;
                        console.warn(`Kunci OpenRouter #${currentOpenRouterKeyIndex + 1} gagal: ${errorMessage}. Mencoba berikutnya...`);
                        lastAiResponse = `Gagal di Kunci OpenRouter #${currentOpenRouterKeyIndex + 1}: ${errorMessage}`;

                    } catch (error) {
                         console.warn(`Error request dengan Kunci OpenRouter #${currentOpenRouterKeyIndex + 1}: ${error.message}. Mencoba berikutnya...`);
                         lastAiResponse = `Gagal di Kunci OpenRouter #${currentOpenRouterKeyIndex + 1}: ${error.message}`;
                    }

                    currentOpenRouterKeyIndex = (currentOpenRouterKeyIndex + 1) % OPENROUTER_API_KEYS.length;
                    if (i === OPENROUTER_API_KEYS.length - 1) {
                        deepseekKeyFailed = true;
                    }
                }

                if (!aiResponseText && deepseekKeyFailed) {
                    throw new Error("Semua kunci API OpenRouter gagal.");
                }
            }

            // --- 4. Return ---
            console.log("Respon mentah AI:", aiResponseText);
            lastAiResponse = aiResponseText;
            return aiResponseText;

        } catch (error) {
            console.error(`Gagal mendapatkan jawaban AI (${currentAiProvider}):`, error.message);
            lastAiResponse = `Error: ${error.message}`;
            throw error;
        }
    }


    async function performAction(aiAnswerText, quizData) {
    if (!aiAnswerText) return;

    const getElementColor = (element) => {
        const style = window.getComputedStyle(element);
        const bgImage = style.backgroundImage;
        if (bgImage && bgImage.includes('gradient')) {
            const match = bgImage.match(/rgb\(\d+, \d+, \d+\)/);
            if (match) return match[0];
        }
        return style.backgroundColor || 'rgba(0, 255, 0, 0.5)';
    };

    switch (quizData.questionType) {
        case 'multi_dropdown':
            const popperSelector = '.v-popper__popper--shown';
            const answers = aiAnswerText.split('\n').map(line => {
                const match = line.match(/\[RESPOSTA (\d+)\]:\s*(.*)/i);
                if (!match) return null;
                return {
                    index: parseInt(match[1], 10) - 1,
                    answer: match[2].trim().replace(/["'`]/g, '')
                };
            }).filter(Boolean);

            const answersMap = new Map(answers.map(a => [a.index, a.answer]));
            const placeholderText = 'Selecionar resposta'; // Teks asli dari Quizizz mungkin tidak perlu diterjemahkan jika ini string internal

            // Fase 1: Pembersihan
            console.log("FASE 1: Membersihkan dropdown dengan jawaban salah atau tidak perlu...");
            for (let i = 0; i < quizData.dropdowns.length; i++) {
                const dd = quizData.dropdowns[i];
                const currentButtonText = dd.button.innerText.trim();
                const targetAnswer = answersMap.get(i);

                const isFilled = currentButtonText !== placeholderText;
                const hasTarget = !!targetAnswer;
                const isWrong = isFilled && hasTarget && currentButtonText !== targetAnswer;
                const isUnnecessary = isFilled && !hasTarget;

                if (isWrong || isUnnecessary) {
                    console.log(`Membersihkan Dropdown #${i + 1} (sebelumnya berisi "${currentButtonText}")...`);
                    dd.button.click();
                    try {
                        const optionElements = await waitForElement(`${popperSelector} button.dropdown-option`, true, 2000);
                        const selectedOption = Array.from(optionElements).find(el => el.innerText.trim() === currentButtonText);
                        if (selectedOption) {
                            selectedOption.click();
                        } else {
                            document.body.click();
                        }
                        await waitForElementToDisappear(popperSelector, 2000);
                    } catch (e) {
                        console.error(`Error saat mencoba membersihkan Dropdown #${i + 1}: ${e.message}`);
                        if (document.querySelector(popperSelector)) {
                            document.body.click();
                            try { await waitForElementToDisappear(popperSelector, 2000); } catch (err) {}
                        }
                    }
                }
            }

            // Fase 2: Pengisian
            console.log("FASE 2: Mengisi jawaban benar dari AI...");
            for (const res of answers) {
                const dd = quizData.dropdowns[res.index];
                if (!dd) {
                    console.error(`Dropdown dengan indeks ${res.index} tidak ditemukan.`);
                    continue;
                }
                const currentButtonText = dd.button.innerText.trim();
                if (currentButtonText === res.answer) {
                    continue;
                }
                dd.button.click();
                try {
                    const optionElements = await waitForElement(`${popperSelector} button.dropdown-option`, true, 2000);
                    const targetOption = Array.from(optionElements).find(el => el.innerText.trim() === res.answer);
                    if (targetOption) {
                        if (targetOption.disabled || targetOption.classList.contains('used-option')) {
                            console.warn(`Opsi "${res.answer}" untuk Dropdown #${res.index + 1} masih dinonaktifkan.`);
                            document.body.click();
                        } else {
                            targetOption.click();
                        }
                    } else {
                        console.error(`Opsi "${res.answer}" tidak ditemukan di Dropdown #${res.index + 1}. (AI mungkin berhalusinasi)`);
                        document.body.click();
                    }
                    await waitForElementToDisappear(popperSelector, 2000);
                } catch (e) {
                    console.error(`Error saat mencoba memilih untuk dropdown #${res.index + 1}: ${e.message}`);
                    if (document.querySelector(popperSelector)) {
                        document.body.click();
                        try { await waitForElementToDisappear(popperSelector, 2000); } catch (err) {}
                    }
                }
            }
            break;

        case 'multi_drag_into_blank':
            const highlightColors = ['#FFD700', '#00FFFF', '#FF00FF', '#7FFF00', '#FF8C00', '#DA70D6'];
            let colorIndex = 0;
            const cleanPairPartMulti = (str) => str.replace(/[`"']/g, '').trim();
            const pairingsMulti = aiAnswerText.split('\n').filter(line => line.includes('->')).map(line => {
                const parts = line.split('->');
                return parts.length === 2 ? [cleanPairPartMulti(parts[0]), cleanPairPartMulti(parts[1])] : null;
            }).filter(Boolean);
            if (pairingsMulti.length === 0) { console.error("Tidak dapat mengekstrak pasangan valid dari jawaban AI."); return; }
            const draggableMap = new Map(quizData.draggableOptions.map(i => [i.text, i.element]));
            const dropZoneMap = new Map(quizData.dropZones.map(i => [i.prompt, i.blankElement]));
            for (const [promptText, optionText] of pairingsMulti) {
                const bestPromptMatch = [...dropZoneMap.keys()].find(key => key.includes(promptText) || promptText.includes(key));
                const blankEl = dropZoneMap.get(bestPromptMatch);
                const optionEl = draggableMap.get(optionText);
                if (blankEl && optionEl) {
                    const color = highlightColors[colorIndex % highlightColors.length];
                    const highlightStyle = `box-shadow: 0 0 15px 5px ${color}; border-radius: 4px;`;
                    blankEl.style.cssText = highlightStyle;
                    optionEl.style.cssText = highlightStyle;
                    colorIndex++;
                } else {
                    console.warn(`Pasangan tidak ditemukan di DOM: "${promptText}" -> "${optionText}"`);
                }
            }
            break;

        case 'equation':
            const KEYPAD_MAP = {
                '0': 'icon-fas-0', '1': 'icon-fas-1', '2': 'icon-fas-2', '3': 'icon-fas-3', '4': 'icon-fas-4',
                '5': 'icon-fas-5', '6': 'icon-fas-6', '7': 'icon-fas-7', '8': 'icon-fas-8', '9': 'icon-fas-9',
                '+': 'icon-fas-plus', '-': 'icon-fas-minus', '*': 'icon-fas-times', '×': 'icon-fas-times',
                '/': 'icon-fas-divide', '÷': 'icon-fas-divide', '=': 'icon-fas-equals', '.': 'icon-fas-period',
                '<': 'icon-fas-less-than', '>': 'icon-fas-greater-than',
                '≤': 'icon-fas-less-than-equal', '≥': 'icon-fas-greater-than-equal',
                'x': 'icon-fas-variable', 'y': 'icon-fas-variable', 'z': 'icon-fas-variable',
                '(': 'icon-fas-brackets-round', ')': 'icon-fas-brackets-round',
                'π': 'icon-fas-pi', 'e': 'icon-fas-euler',
            };
            let answerSequence = aiAnswerText.trim().replace(/\s/g, '').replace(/<=/g, '≤').replace(/>=/g, '≥');
            console.log(`Mengetik jawaban: ${answerSequence}`);
            const editor = document.querySelector('div[data-cy="equation-editor"]');
            if (editor) {
                editor.click();
                await new Promise(r => setTimeout(r, 100));
            } else {
                console.error("Tidak dapat menemukan editor persamaan untuk fokus.");
                return;
            }
            for (const char of answerSequence) {
                const iconClass = KEYPAD_MAP[char.toLowerCase()];
                if (iconClass) {
                    const keyElement = document.querySelector(`.editor-button i.${iconClass}`);
                    if (keyElement) {
                        const button = keyElement.closest('button');
                        if (button) {
                            button.click();
                            await new Promise(r => setTimeout(r, 100));
                        }
                    } else {
                        console.error(`Tidak dapat menemukan tombol untuk karakter: "${char}" (ikon: ${iconClass})`);
                    }
                } else {
                    console.error(`Karakter tidak dipetakan di keypad: "${char}"`);
                }
            }
            break;

        case 'reorder':
            const cleanText = (str) => str.replace(/["'`]/g, '').trim();
            const orderedItems = aiAnswerText.split('\n').map(cleanText).filter(Boolean);
            const draggablesMapReorder = new Map(quizData.draggableItems.map(i => [i.text, i.element]));
            const dropZonesInOrder = quizData.dropZones;
            if (orderedItems.length === dropZonesInOrder.length) {
                for (let i = 0; i < orderedItems.length; i++) {
                    const sourceText = orderedItems[i];
                    const sourceEl = draggablesMapReorder.get(sourceText);
                    const destinationEl = dropZonesInOrder[i].element;
                    if (sourceEl && destinationEl) {
                        const color = getElementColor(sourceEl);
                        const highlightStyle = `box-shadow: 0 0 15px 5px ${color}; border-radius: 8px;`;
                        sourceEl.style.cssText = highlightStyle;
                        destinationEl.style.cssText = highlightStyle;
                    }
                }
            }
            break;

        case 'drag_into_blank':
            const cleanAiAnswerBlank = aiAnswerText.trim().replace(/["'`]/g, '');
            const targetOption = quizData.draggableOptions.find(opt => opt.text === cleanAiAnswerBlank);
            if (targetOption) {
                const color = getElementColor(targetOption.element);
                const highlightStyle = `box-shadow: 0 0 15px 5px ${color}`;
                targetOption.element.style.cssText = highlightStyle;
                quizData.dropZone.element.style.cssText = highlightStyle;
            }
            break;

        case 'match_image_to_text':
            const highlightColorsImg = ['#FFD700', '#00FFFF', '#FF00FF', '#7FFF00', '#FF8C00', '#DA70D6'];
            let colorIndexImg = 0;

            const cleanPairPartImg = (str) => str.replace(/[`"\[\]]/g, '').trim();

            const pairingsImg = aiAnswerText.split('\n').filter(line => line.includes('->')).map(line => {
                const parts = line.split('->');
                return parts.length === 2 ? [cleanPairPartImg(parts[0]), cleanPairPartImg(parts[1])] : null;
            }).filter(Boolean);

            if (pairingsImg.length === 0) { console.error("Tidak dapat mengekstrak pasangan valid (Teks -> ID Gambar) dari jawaban AI."); return; }

            const draggablesMapImg = new Map(quizData.draggableItems.map(i => [i.id, i.element]));
            const dropZonesMapImg = new Map(quizData.dropZones.map(i => [i.text, i.element]));

            for (const [partA, partB] of pairingsImg) {
                let sourceEl, destinationEl;
                if (dropZonesMapImg.has(partA) && draggablesMapImg.has(partB)) {
                    destinationEl = dropZonesMapImg.get(partA);
                    sourceEl = draggablesMapImg.get(partB);
                } else if (dropZonesMapImg.has(partB) && draggablesMapImg.has(partA)) {
                    destinationEl = dropZonesMapImg.get(partB);
                    sourceEl = draggablesMapImg.get(partA);
                } else {
                    console.warn(`Pasangan tidak dipetakan: "${partA}" (ada? ${dropZonesMapImg.has(partA)}) -> "${partB}" (ada? ${draggablesMapImg.has(partB)})`);
                    continue;
                }

                if (sourceEl && destinationEl) {
                    const color = highlightColorsImg[colorIndexImg % highlightColorsImg.length];
                    const highlightStyle = `box-shadow: 0 0 15px 5px ${color}; border-radius: 8px;`;
                    sourceEl.style.cssText = highlightStyle;
                    destinationEl.style.cssText = highlightStyle;
                    colorIndexImg++;
                }
            }
            break;

        case 'match_order':
            const cleanPairPart = (str) => str.replace(/[`"']/g, '').trim();
            const pairings = aiAnswerText.split('\n').filter(line => line.includes('->')).map(line => {
                const parts = line.split('->');
                return parts.length === 2 ? [cleanPairPart(parts[0]), cleanPairPart(parts[1])] : null;
            }).filter(Boolean);
            if (pairings.length === 0) { console.error("Tidak dapat mengekstrak pasangan valid dari jawaban AI."); return; }
            const draggablesMapMatch = new Map(quizData.draggableItems.map(i => [i.text, i.element]));
            const dropZonesMap = new Map(quizData.dropZones.map(i => [i.text, i.element]));
            for (const [partA, partB] of pairings) {
                let sourceEl, destinationEl;
                if (dropZonesMap.has(partA) && draggablesMapMatch.has(partB)) {
                    destinationEl = dropZonesMap.get(partA);
                    sourceEl = draggablesMapMatch.get(partB);
                } else if (dropZonesMap.has(partB) && draggablesMapMatch.has(partA)) {
                    destinationEl = dropZonesMap.get(partB);
                    sourceEl = draggablesMapMatch.get(partA);
                } else { continue; }
                if (sourceEl && destinationEl) {
                    const color = getElementColor(sourceEl);
                    const highlightStyle = `box-shadow: 0 0 15px 5px ${color}; border-radius: 8px;`;
                    sourceEl.style.cssText = highlightStyle;
                    destinationEl.style.cssText = highlightStyle;
                }
            }
            break;

        default:
            const normalize = (str) => {
                if (typeof str !== 'string') return '';
                // (v48) Menjaga huruf, angka, spasi, dan simbol ² dan ³
                let cleaned = str.replace(/[^a-zA-Z\u00C0-\u017F0-9\s²³]/g, '').replace(/\s+/g, ' ');
                return cleaned.trim().toLowerCase();
            };

            if (quizData.questionType === 'open_ended') {
                await new Promise(resolve => {
                    quizData.answerElement.focus();
                    quizData.answerElement.value = aiAnswerText.trim();
                    quizData.answerElement.dispatchEvent(new Event('input', { bubbles: true }));
                    setTimeout(resolve, 100);
                });
                setTimeout(() => document.querySelector('.submit-button-wrapper button, button.submit-btn')?.click(), 500);
            } else if (quizData.questionType === 'multiple_choice') {
                const aiAnswers = aiAnswerText.split('\n').map(normalize).filter(Boolean);
                quizData.options.forEach(opt => {
                    if (aiAnswers.includes(normalize(opt.text))) {
                        opt.element.style.border = '5px solid #00FF00';
                        opt.element.click();
                    }
                });
            } else if (quizData.questionType === 'single_choice') {
                const normalizedAiAnswer = normalize(aiAnswerText);
                const bestMatch = quizData.options.find(opt => {
                    const normalizedOption = normalize(opt.text);
                    return normalizedOption === normalizedAiAnswer;
                });

                if (bestMatch) {
                    console.log("Kecocokan ditemukan!", bestMatch.element);
                    bestMatch.element.style.border = '5px solid #00FF00';
                    bestMatch.element.click();
                } else {
                    console.warn("Tidak ada kecocokan persis yang ditemukan setelah normalisasi.");
                }
            }
            break;
    }
}

    async function resolverQuestao() {
    const button = document.getElementById('ai-solver-button');
    button.disabled = true;
    button.innerText = "Berpikir...";
    button.style.transform = 'scale(0.95)';
    button.style.boxShadow = '0 0 0 rgba(0,0,0,0)';
    try {
        const quizData = await extrairDadosDaQuestao();
        if (!quizData) {
            alert("Tidak dapat mengekstrak data pertanyaan.");
            return;
        }

        if (quizData.questionType === 'multi_dropdown') {
             console.log("Menggunakan AI untuk menyelesaikan multi dropdown (logika pool)...");
             const aiAnswer = await obterRespostaDaIA(quizData);
             if (aiAnswer) {
                 await performAction(aiAnswer, quizData);
             }
        } else if (quizData.questionType === 'dropdown') {
            console.log("Memulai alur optimalisasi untuk Dropdown...");
            quizData.dropdownButton.click();
            try {
                const optionElements = await waitForElement('.v-popper__popper--shown button.dropdown-option', true);
                quizData.options = Array.from(optionElements).map(el => ({ text: el.innerText.trim() }));
                const aiAnswer = await obterRespostaDaIA(quizData);
                if (aiAnswer) {
                    const cleanAiAnswerDrop = aiAnswer.trim().replace(/["'`]/g, '');
                    const targetOptionDrop = Array.from(optionElements).find(el => el.innerText.trim() === cleanAiAnswerDrop);
                    if (targetOptionDrop) {
                        targetOptionDrop.click();
                    } else {
                        console.error(`Tidak dapat menemukan opsi dropdown dengan teks: "${cleanAiAnswerDrop}"`);
                        document.body.click();
                    }
                } else {
                     document.body.click();
                }
            } catch (error) {
                console.error("Gagal memproses dropdown:", error.message);
                document.body.click();
            }
        } else {
            const isMath = quizData.options && quizData.options.length > 0 && (quizData.options[0].text.includes('\\') || quizData.questionText.toLowerCase().includes('value of'));
            const matchValue = quizData.questionText.match(/value of ([\d.]+)/i);
            if (isMath && matchValue) {
                console.log("Pertanyaan matematika terdeteksi. Menyelesaikan secara lokal...");
                const targetValue = parseFloat(matchValue[1]);
                quizData.options.forEach(option => {
                    const computableExpr = (() => {
                        let c = option.text.replace(/\\left/g, '').replace(/\\right/g, '').replace(/\\div/g, '/').replace(/\\times/g, '*').replace(/\\ /g, '').replace(/(\d+)\s*\(/g, '$1 * (').replace(/\)\s*(\d+)/g, ') * $1');
                        c = c.replace(/(\d+)\\frac\{(\d+)\}\{(\d+)\}/g, '($1+$2/$3)');
                        c = c.replace(/\\frac\{(\d+)\}\{(\d+)\}/g, '($1/$2)');
                        return c;
                    })();
                    const result = (() => { try { return new Function('return ' + computableExpr)(); } catch (e) { return null; } })();
                    if (result !== null && Math.abs(result - targetValue) < 0.001) {
                        option.element.style.border = '5px solid #00FF00';
                        option.element.click();
                    }
                });
            } else {
                console.log("Menggunakan AI untuk menyelesaikan...");
                const aiAnswer = await obterRespostaDaIA(quizData);
                if (aiAnswer) {
                    await performAction(aiAnswer, quizData);
                }
            }
        }
    } catch (error) {
        console.error("Terjadi kesalahan tak terduga di alur utama:", error);
        if (error.message && !error.message.includes("Tindakan dibatalkan")) {
            alert("Terjadi kesalahan: " + error.message);
        }
    } finally {
        const viewResponseBtn = document.getElementById('view-raw-response-btn');
        if (viewResponseBtn && lastAiResponse) {
            viewResponseBtn.style.display = 'block';
        }
        button.disabled = false;
        button.innerText = "✨ Selesaikan";
        button.style.transform = 'scale(1)';
        button.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
    }
}

    // --- LOGIKA UI (v50) ---

    function mostrarAvisoDeepSeekImagem() {
        return new Promise((resolve, reject) => {
            const oldModal = document.getElementById('deepseek-warning-modal');
            if (oldModal) oldModal.remove();

            const overlay = document.createElement('div');
            overlay.id = 'deepseek-warning-modal';
            Object.assign(overlay.style, {
                position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
                backgroundColor: 'rgba(0, 0, 0, 0.6)', zIndex: '2147483648',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'opacity 0.2s ease', opacity: '0'
            });

            const modalContainer = document.createElement('div');
            Object.assign(modalContainer.style, {
                background: 'rgba(26, 27, 30, 0.9)', backdropFilter: 'blur(10px)',
                padding: '24px', borderRadius: '16px', color: 'white',
                fontFamily: 'system-ui, sans-serif', maxWidth: '400px',
                textAlign: 'center', boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
                border: '1px solid rgba(255, 255, 255, 0.1)'
            });

            const title = document.createElement('h3');
            title.innerText = '⚠️ DeepSeek Tidak Melihat Gambar';
            Object.assign(title.style, {
                margin: '0 0 12px 0', fontSize: '18px', fontWeight: '600'
            });

            const message = document.createElement('p');
            message.innerText = 'Pertanyaan ini mengandung satu atau lebih gambar yang tidak dapat diproses oleh DeepSeek. Apa yang ingin Anda lakukan?';
            Object.assign(message.style, {
                margin: '0 0 20px 0', fontSize: '14px', lineHeight: '1.5',
                color: 'rgba(255, 255, 255, 0.8)'
            });

            const buttonContainer = document.createElement('div');
            Object.assign(buttonContainer.style, {
                display: 'flex', flexDirection: 'column', gap: '10px'
            });

            const closeModal = () => {
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 200);
            };

            const btnGemini = document.createElement('button');
            btnGemini.innerText = 'Gunakan Gemini (Disarankan)';
            Object.assign(btnGemini.style, {
                background: 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%)',
                border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer',
                fontSize: '14px', fontWeight: '500', padding: '12px',
                transition: 'all 0.2s ease'
            });
            btnGemini.onmouseover = () => btnGemini.style.opacity = '0.9';
            btnGemini.onmouseout = () => btnGemini.style.opacity = '1';
            btnGemini.onclick = () => {
                closeModal();
                resolve('gemini');
            };

            const btnNoImage = document.createElement('button');
            btnNoImage.innerText = 'Jawab tanpa mengirim Gambar';
            Object.assign(btnNoImage.style, {
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '8px', color: 'rgba(255, 255, 255, 0.8)',
                cursor: 'pointer', fontSize: '14px', fontWeight: '500',
                padding: '12px', transition: 'all 0.2s ease'
            });
            btnNoImage.onmouseover = () => btnNoImage.style.background = 'rgba(255, 255, 255, 0.15)';
            btnNoImage.onmouseout = () => btnNoImage.style.background = 'rgba(255, 255, 255, 0.1)';
            btnNoImage.onclick = () => {
                closeModal();
                resolve('sem_imagem');
            };

            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    closeModal();
                    reject(new Error('Tindakan dibatalkan.'));
                }
            };

            buttonContainer.appendChild(btnGemini);
            buttonContainer.appendChild(btnNoImage);
            modalContainer.appendChild(title);
            modalContainer.appendChild(message);
            modalContainer.appendChild(buttonContainer);
            overlay.appendChild(modalContainer);
            document.body.appendChild(overlay);

            setTimeout(() => overlay.style.opacity = '1', 10);
        });
    }

    /**
     * Membuat panel mengambang dapat diseret. (v50)
     * @param {HTMLElement} panel - Elemen utama panel.
     * @param {HTMLElement} handle - Elemen pemicu drag (dalam hal ini, panel itu sendiri).
     */
    function makeDraggable(panel, handle) {
        let offsetX = 0, offsetY = 0, isDragging = false;

        handle.addEventListener('mousedown', (e) => {
            // Mencegah drag jika klik pada tombol atau link
            if (e.target.tagName === 'BUTTON' || e.target.closest('a')) return;

            isDragging = true;
            const rect = panel.getBoundingClientRect();

            // Konversi posisi 'bottom'/'right' ke 'top'/'left' saat pertama kali
            if (panel.style.bottom || panel.style.right) {
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                panel.style.top = rect.top + 'px';
                panel.style.left = rect.left + 'px';
            }

            offsetX = e.clientX - panel.getBoundingClientRect().left;
            offsetY = e.clientY - panel.getBoundingClientRect().top;

            panel.style.transition = 'none'; // Nonaktifkan transisi halus saat menyeret
            handle.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            let newX = e.clientX - offsetX;
            let newY = e.clientY - offsetY;

            // Menjaga panel tetap di dalam layar
            newX = Math.max(0, Math.min(newX, window.innerWidth - panel.offsetWidth));
            newY = Math.max(0, Math.min(newY, window.innerHeight - panel.offsetHeight));

            panel.style.top = newY + 'px';
            panel.style.left = newX + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            panel.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out'; // Aktifkan kembali
            handle.style.cursor = 'default';
        });
    }

    function criarFloatingPanel() {
        if (document.getElementById('mzzvxm-floating-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'mzzvxm-floating-panel';
        Object.assign(panel.style, {
            position: 'fixed', bottom: '60px', right: '20px', zIndex: '2147483647',
            display: 'flex', flexDirection: 'column', alignItems: 'stretch',
            gap: '10px', padding: '12px', backgroundColor: 'rgba(26, 27, 30, 0.7)',
            backdropFilter: 'blur(8px)', webkitBackdropFilter: 'blur(8px)', borderRadius: '16px',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4)',
            transition: 'transform 0.3s ease-out, opacity 0.3s ease-out',
            transform: 'translateY(20px)', opacity: '0',
            cursor: 'default'
        });

        const responseViewer = document.createElement('div');
        responseViewer.id = 'ai-response-viewer';
        Object.assign(responseViewer.style, {
            display: 'none', position: 'absolute', bottom: 'calc(100% + 10px)', right: '0',
            width: '300px', maxHeight: '200px', overflowY: 'auto',
            background: 'rgba(10, 10, 15, 0.9)', backdropFilter: 'blur(5px)',
            borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.2)',
            padding: '12px', color: '#f0f0f0', fontSize: '12px',
            fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4)',
            textAlign: 'left'
        });
        panel.appendChild(responseViewer);

        const viewResponseBtn = document.createElement('button');
        viewResponseBtn.id = 'view-raw-response-btn';
        Object.assign(viewResponseBtn.style, {
            background: 'none', border: '1px solid rgba(255, 255, 255, 0.2)',
            color: 'rgba(255, 255, 255, 0.6)', cursor: 'pointer',
            fontSize: '11px', padding: '4px 8px', borderRadius: '6px',
            display: 'none', transition: 'all 0.2s ease',
            marginBottom: '4px'
        });
        viewResponseBtn.innerText = 'Lihat Jawaban AI';
        viewResponseBtn.addEventListener('click', () => {
            if (responseViewer.style.display === 'block') {
                responseViewer.style.display = 'none';
            } else {
                responseViewer.innerText = lastAiResponse || "Belum ada jawaban dari AI.";
                responseViewer.style.display = 'block';
            }
        });
        panel.appendChild(viewResponseBtn);

        // --- Botão Ocultar (v50) ---
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'toggle-ui-btn';
        toggleBtn.innerText = 'Sembunyikan';
        Object.assign(toggleBtn.style, {
            background: 'none', border: '1px solid rgba(255, 255, 255, 0.2)',
            color: 'rgba(255, 255, 255, 0.6)', cursor: 'pointer',
            fontSize: '11px', padding: '4px 8px', borderRadius: '6px',
            transition: 'all 0.2s ease',
            marginBottom: '4px'
        });
        panel.appendChild(toggleBtn);
        // --- Akhir Botão Ocultar ---

        const aiToggleBtn = document.createElement('button');
        aiToggleBtn.id = 'ai-toggle-btn';
        aiToggleBtn.innerText = 'AI: Gemini';
        Object.assign(aiToggleBtn.style, {
            background: 'none', border: '1px solid rgba(255, 255, 255, 0.2)',
            color: 'rgba(255, 255, 255, 0.6)', cursor: 'pointer',
            fontSize: '11px', padding: '4px 8px', borderRadius: '6px',
            transition: 'all 0.2s ease',
            marginBottom: '4px'
        });
        aiToggleBtn.addEventListener('click', () => {
            if (currentAiProvider === 'gemini') {
                currentAiProvider = 'deepseek';
                aiToggleBtn.innerText = 'AI: DeepSeek';
                aiToggleBtn.style.color = '#a78bfa';
            } else {
                currentAiProvider = 'gemini';
                aiToggleBtn.innerText = 'AI: Gemini';
                aiToggleBtn.style.color = 'rgba(255, 255, 255, 0.6)';
            }
            console.log(`Provider AI diubah menjadi: ${currentAiProvider}`);
        });
        panel.appendChild(aiToggleBtn);

        const button = document.createElement('button');
        button.id = 'ai-solver-button';
        button.innerHTML = '✨ Selesaikan';
        Object.assign(button.style, {
            background: 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%)',
            border: 'none', borderRadius: '10px', color: 'white', cursor: 'pointer',
            fontFamily: 'system-ui, sans-serif', fontSize: '15px', fontWeight: '600',
            padding: '10px 20px', boxShadow: '0 4px 10px rgba(0, 0, 0, 0.2)',
            transition: 'all 0.2s ease', letterSpacing: '0.5px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
        });
        button.addEventListener('mouseover', () => { button.style.transform = 'translateY(-2px)'; button.style.boxShadow = '0 6px 15px rgba(0, 0, 0, 0.3)'; });
        button.addEventListener('mouseout', () => { button.style.transform = 'translateY(0)'; button.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.2)'; });
        button.addEventListener('mousedown', () => { button.style.transform = 'translateY(1px)'; button.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.15)'; });
        button.addEventListener('mouseup', () => { button.style.transform = 'translateY(-2px)'; button.style.boxShadow = '0 6px 15px rgba(0, 0, 0, 0.3)'; });
        button.addEventListener('click', resolverQuestao);
        panel.appendChild(button);

        const watermark = document.createElement('div');
        watermark.id = 'mzzvxm-watermark'; // ID untuk menyembunyikan
        const githubIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 3c-.58.0-1.25.27-2 1.5c-2.2.86-4.5 1.3-7 1.3-2.5 0-4.7-.44-7-1.3-.75-1.23-1.42-1.5-2-1.5A5.07 5.07 0 0 0 4 4.77 5.44 5.44 0 0 0 2 10.71c0 6.13 3.49 7.34 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>`;
        const instagramIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>`;
        watermark.innerHTML = `
            <div style="display: flex; gap: 8px; align-items: center; color: rgba(255,255,255,0.7); margin-top: 8px; justify-content: flex-end;">
                <span style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 13px; font-weight: 400;">@mzzvxm</span>
                <a href="https://github.com/mzzvxm" target="_blank" title="GitHub" style="line-height: 0; color: inherit; transition: color 0.2s ease;">${githubIcon}</a>
                <a href="httpsa://instagram.com/mzzvxm" target="_blank" title="Instagram" style="line-height: 0; color: inherit; transition: color 0.2s ease;">${instagramIcon}</a>
            </div>
        `;
        watermark.querySelectorAll('a').forEach(link => {
            link.addEventListener('mouseover', () => link.style.color = 'white');
            link.addEventListener('mouseout', () => link.style.color = 'rgba(255,255,255,0.7)');
        });
        panel.appendChild(watermark);
        document.body.appendChild(panel);

        // --- LOGIKA SEMBUNYIKAN/TAMPILKAN (v50) ---
        const contentToToggle = [
            'view-raw-response-btn',
            'ai-toggle-btn',
            'ai-solver-button',
            'mzzvxm-watermark'
        ];

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Mencegah klik pada tombol memulai drag
            const isHidden = toggleBtn.innerText === 'Tampilkan';
            toggleBtn.innerText = isHidden ? 'Sembunyikan' : 'Tampilkan';

            contentToToggle.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.style.display = isHidden ? '' : 'none';
                }
            });

            // Terapkan kembali 'display: none' ke viewResponseBtn jika sudah tersembunyi
            if (isHidden && !lastAiResponse) {
                 document.getElementById('view-raw-response-btn').style.display = 'none';
            }
        });

        // --- LOGIKA SERET (v50) ---
        // Pegangannya adalah seluruh panel
        makeDraggable(panel, panel);

        setTimeout(() => {
            panel.style.transform = 'translateY(0)';
            panel.style.opacity = '1';
        }, 100);
        console.log("Floating Panel pemecah v50 berhasil dibuat!");
    }

    // --- LOGIKA DETEKSI ID KUIS (v46) ---

    function logQuizId(id, source) {
        if (id === quizIdDetected) {
            return;
        }
        quizIdDetected = id;
        console.log(`[Quizizz Bypass] ID Kuis Baru terdeteksi (${source}): %c${id}`, "color: #00FF00; font-weight: bold;");
    }

    function detectQuizIdFromURL() {
        const match = window.location.pathname.match(regexQuizId);
        return match ? match[1] : null;
    }

    function interceptFetch() {
        const originalFetch = window.fetch;
        window.fetch = async function (...args) {
            const [resource] = args;
            if (typeof resource === 'string') {
                const match = resource.match(regexQuizId);
                if (match) {
                    const id = match[1];
                    logQuizId(id, "fetch");
                }
            }
            return originalFetch.apply(this, args);
        };
    }

    function interceptXHR() {
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            if (typeof url === 'string') {
                const match = url.match(regexQuizId);
                if (match) {
                    const id = match[1];
                    logQuizId(id, "XHR");
                }
            }
            return originalOpen.apply(this, arguments);
        };
    }

    function initQuizIdDetector() {
        console.log("[Quizizz Bypass] Detektor ID Kuis dimuat.");
        const id = detectQuizIdFromURL();
        if (id) {
            logQuizId(id, "URL");
        }

        if (!interceptorsStarted) {
            console.log("[Quizizz Bypass] Memulai interseptor jaringan (fetch/XHR).");
            interceptFetch();
            interceptXHR();
            interceptorsStarted = true;
        }
    }

    (function monitorSPA() {
        const pushState = history.pushState;
        history.pushState = function () {
            const result = pushState.apply(this, arguments);
            setTimeout(initQuizIdDetector, 300);
            return result;
        };
        window.addEventListener("popstate", () => setTimeout(initQuizIdDetector, 300));
    })();

    // --- AKHIR LOGIKA DETEKSI ID KUIS ---


    async function fetchWithTimeout(resource, options = {}, timeout = 15000) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(resource, { ...options, signal: controller.signal });
            clearTimeout(id);
            return response;
        } catch (error) {
            clearTimeout(id);
            if (error.name === 'AbortError') throw new Error('Permintaan terlalu lama dan dibatalkan (Timeout).');
            throw error;
        }
    }

    async function imageUrlToBase64(url) {
        try {
            const cacheBustUrl = new URL(url);
            cacheBustUrl.searchParams.set('_t', new Date().getTime());

            const r = await fetchWithTimeout(cacheBustUrl.href, { cache: 'no-store' });
            const b = await r.blob();
            return new Promise((res, rej) => {
                const reader = new FileReader();
                reader.onloadend = () => res(reader.result);
                reader.onerror = (e) => {
                    console.error("Error pada FileReader:", e);
                    rej(e);
                };
                reader.readAsDataURL(b);
            });
        } catch (e) {
            console.error(`Error saat mengonversi gambar: ${e.message}`, url);
            return null;
        }
    }

    // --- Start ---
    setTimeout(criarFloatingPanel, 2000); // Memulai UI
    initQuizIdDetector(); // Memulai detektor ID

})();
