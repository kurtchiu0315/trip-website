/* 由 scripts/fetch-hero-photos.js 產生，請勿手動編輯 */
/* 照片來源：Wikimedia Commons，皆為自由授權、近五年拍攝，作者與授權標示於頁首下方 */
(function (global) {
  'use strict';

  var PHOTOS = [
    {
      "file": "tokyo-station.jpg",
      "caption": "東京駅 丸の内",
      "author": "Dick Thomas Johnson",
      "license": "CC BY 2.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:KITTE_Garden,_Tokyo;_September_2022_(09).jpg"
    },
    {
      "file": "ikebukuro.jpg",
      "caption": "池袋站 西武百貨",
      "author": "MaedaAkihiko",
      "license": "CC BY-SA 4.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Ikebukuro-STA_East.jpg"
    },
    {
      "file": "meiji-jingu.jpg",
      "caption": "明治神宮 大鳥居",
      "author": "江戸村のとくぞう",
      "license": "CC BY-SA 4.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Courtyard_of_Meiji_Shrine_20220814a.jpg"
    },
    {
      "file": "gaien-ginkgo.jpg",
      "caption": "神宮外苑 銀杏並木",
      "author": "Dick Thomas Johnson from Tokyo, Japan",
      "license": "CC BY 2.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Meiji_Jingu_Gaien_Ginkgo_Festival_(53442107390).jpg"
    },
    {
      "file": "shinjuku-gyoen.jpg",
      "caption": "新宿御苑",
      "author": "Jakub Hałun",
      "license": "CC BY 4.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Upper_Pond,_Shinjuku_Gyoen_National_Garden,_Tokyo,_20240822_1512_5467.jpg"
    },
    {
      "file": "gotokuji.jpg",
      "caption": "豪德寺 招財貓",
      "author": "LeLaisserPasserA38",
      "license": "CC0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:ManekiNekoGotokuji2.jpg"
    },
    {
      "file": "komachi-dori.jpg",
      "caption": "鎌倉 小町通",
      "author": "Nesnad",
      "license": "CC BY 4.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Komachi-dori_Street_-_Kamakura_-_2026_Oct_1_various_1.jpg"
    },
    {
      "file": "tsurugaoka.jpg",
      "caption": "鶴岡八幡宮 太鼓橋",
      "author": "VZP10224",
      "license": "CC BY-SA 4.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Tsurugaoka-Hachimangu_Taiko-bashi-East-side_20261018.jpg"
    },
    {
      "file": "kamakura-daibutsu.jpg",
      "caption": "鎌倉大佛（高德院）",
      "author": "Anagoria",
      "license": "CC BY-SA 4.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:20260420_Gro%C3%9Fer_Buddha_von_Kamakura_03,_Kanagawa,_Japan_anagoria.jpg"
    },
    {
      "file": "enoden.jpg",
      "caption": "鎌倉駅 江之電",
      "author": "ProtoplasmaKid",
      "license": "CC BY 4.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Estaci%C3%B3n_Kamakura_JR_East_-_2026_-_03.jpg"
    },
    {
      "file": "enoshima.jpg",
      "caption": "江之島 海之燈塔眺望",
      "author": "SuFlyer",
      "license": "CC0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Enoshima_Samuel_Cocking_Garden_from_the_Enoshima_Sea_Candle_(Feb_2022).jpg"
    },
    {
      "file": "shonan-fuji.jpg",
      "caption": "七里濱 遠眺江之島",
      "author": "663highland",
      "license": "CC BY-SA 4.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:230128_At_Shichirigahama_Kamakura_Kanagawa_pref_Japan04s3.jpg"
    },
    {
      "file": "takao-yakuoin.jpg",
      "caption": "高尾山 藥王院一帶",
      "author": "Syced",
      "license": "CC0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Takao-san_hike_during_winter_6.jpg"
    },
    {
      "file": "takao-cablecar.jpg",
      "caption": "高尾山纜車",
      "author": "Syced",
      "license": "CC0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Around_Takaosanguchi_(11236).jpg"
    },
    {
      "file": "kawaguchiko.jpg",
      "caption": "河口湖 富士山",
      "author": "lumoplank",
      "license": "CC0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Kawaguchiko,_Part_II_-_Kawaguchiko6805.jpg"
    },
    {
      "file": "arakura.jpg",
      "caption": "新倉山淺間公園 忠靈塔",
      "author": "Supanut Arunoprayote",
      "license": "CC BY 4.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Chureito_Pagoda_and_Mount_Fuji_20241022.jpg"
    },
    {
      "file": "kawaguchiko-momiji.jpg",
      "caption": "河口湖 湖畔楓葉",
      "author": "lumoplank",
      "license": "CC0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Kawaguchiko,_Part_I_-_Kawaguchiko6815.jpg"
    },
    {
      "file": "kaminarimon.jpg",
      "caption": "淺草寺 雷門",
      "author": "Nesnad",
      "license": "CC0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Kaminarimon-_Asakusa_-_Nov_8_2021_various_18_23_04_718000.jpeg"
    },
    {
      "file": "nakamise.jpg",
      "caption": "仲見世通",
      "author": "Olaf2",
      "license": "CC BY-SA 4.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Nakamise-Stra%C3%9Fe.jpg"
    },
    {
      "file": "skytree.jpg",
      "caption": "東京晴空塔",
      "author": "Ian G Shingler",
      "license": "CC BY-SA 4.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Aerial_view_of_tokyo_skytree.jpg"
    },
    {
      "file": "rikugien.jpg",
      "caption": "六義園 紅葉",
      "author": "Charlie fong",
      "license": "CC BY 4.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Bunkyo_Rikugien_Panoramic_View_In_Early_Autumn.jpg"
    },
    {
      "file": "ueno-park.jpg",
      "caption": "上野公園 不忍池",
      "author": "先従隗始",
      "license": "CC0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Shinobazu_Pond_(Hasu_Pond_Area)_20211126_02.jpg"
    },
    {
      "file": "ameyoko.jpg",
      "caption": "阿美橫町",
      "author": "Dick Thomas Johnson from Tokyo, Japan",
      "license": "CC BY 2.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Ameya_Yokocho_Shopping_Street_(53150237663).jpg"
    },
    {
      "file": "sumida-river.jpg",
      "caption": "隅田川",
      "author": "Stephen Kelly from San Francisco, CA, USA",
      "license": "CC BY 2.0",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Sumida_River_and_Asakusa_Architecture_(53417021554).jpg"
    }
  ];

  /* base 是 hero 圖片資料夾相對於目前頁面的路徑，例如 '../assets/hero/' */
  global.applyHero = function (base) {
    var host = document.querySelector('[data-hero]');
    if (!host || !PHOTOS.length) return;

    var pick = PHOTOS[Math.floor(Math.random() * PHOTOS.length)];

    var img = document.createElement('img');
    img.className = 'hero-img';
    img.alt = '';            // 純裝飾，讀螢幕軟體略過
    img.decoding = 'async';
    img.src = base + pick.file;
    // 圖還沒載完前先不顯示，避免閃一下未套用樣式的畫面
    img.addEventListener('load', function () { img.classList.add('is-loaded'); });

    var credit = document.createElement('a');
    credit.className = 'hero-credit';
    credit.href = pick.sourceUrl;
    credit.target = '_blank';
    credit.rel = 'noopener';
    credit.textContent = pick.caption + '｜' + pick.author + '／' + pick.license;

    host.insertBefore(img, host.firstChild);
    host.appendChild(credit);
  };

  global.HERO_PHOTOS = PHOTOS;
})(window);
