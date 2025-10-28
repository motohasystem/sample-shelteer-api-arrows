// 状態管理
const state = {
    userLocation: null,
    nearestShelters: [], // 最寄り3件の避難所
    deviceHeading: 0,
    shelters: [],
    // 角度の累積値（360度境界問題対策）
    compassRotation: 0, // コンパス針の累積回転角度
    arrowRotations: [0, 0, 0] // 各矢印の累積回転角度
};

// DOM要素
const elements = {
    status: document.getElementById('status'),
    arrows: [
        document.getElementById('arrow1'),
        document.getElementById('arrow2'),
        document.getElementById('arrow3')
    ],
    arrowLabels: [
        document.getElementById('arrow1Label'),
        document.getElementById('arrow2Label'),
        document.getElementById('arrow3Label')
    ],
    compassNeedle: document.getElementById('compassNeedle'),
    shelterCards: document.getElementById('shelterCards'),
    error: document.getElementById('error'),
    calibrateBtn: document.getElementById('calibrateBtn')
};

// 初期化
async function init() {
    try {
        updateStatus('位置情報を取得中...');
        await getUserLocation();

        updateStatus('避難所データを取得中...');
        await fetchShelters();

        updateStatus('デバイスの向きを取得中...');
        await setupDeviceOrientation();

        updateStatus('準備完了');
        startTracking();
    } catch (error) {
        showError(error.message);
    }
}

// 位置情報取得
function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('位置情報がサポートされていません'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                state.userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                console.log('現在地:', state.userLocation);
                resolve();
            },
            (error) => {
                reject(new Error('位置情報の取得に失敗しました: ' + error.message));
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}

// 市区町村コードを推定（逆ジオコーディング）
async function getCityCode(lat, lng) {
    try {
        // OpenStreetMapのNominatimを使用（無料、登録不要）
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
            {
                headers: {
                    'User-Agent': 'ShelterNavigationApp/1.0'
                }
            }
        );
        const data = await response.json();
        console.log('Geocoding結果（フル）:', data);
        console.log('Address詳細:', data.address);

        // 市区町村名と都道府県名を取得
        // provinceフィールドを優先（日本の都道府県はここに入る）
        const cityName = data.address.city || data.address.town || data.address.village || data.address.suburb;
        const prefectureName = data.address.province || data.address.state;

        console.log('抽出結果 - 市区町村:', cityName, '都道府県:', prefectureName);

        if (!cityName || !prefectureName) {
            console.warn('市区町村名または都道府県名が取得できませんでした');
            throw new Error('住所情報が不完全です');
        }

        // jp-shelter-apiのcity-to-code.jsonから検索
        const codeResponse = await fetch('https://motohasystem.github.io/jp-shelter-api/api/v0/city-to-code.json');
        const codeData = await codeResponse.json();

        console.log('city-to-code.json取得成功。エントリ数:', Object.keys(codeData).length);

        // 都道府県名 + 市区町村名で検索（完全一致）
        let fullName = prefectureName + cityName;
        console.log('検索キー（完全）:', fullName);

        if (codeData[fullName]) {
            console.log('✓ 完全一致で発見:', fullName, '→', codeData[fullName]);
            return codeData[fullName];
        }

        // 部分一致で検索
        console.log('完全一致なし。部分一致を試行...');
        const cityCode = Object.entries(codeData).find(([code, name]) => {
            const match = name.includes(cityName) && name.includes(prefectureName);
            if (match) {
                console.log('部分一致:', name, '→', code);
            }
            return match;
        });

        if (cityCode) {
            return cityCode[1]; // city-to-code.jsonは[地名, コード]の形式
        }

        // 市区町村名のみで検索（都道府県が一致しない場合）
        console.log('都道府県含む検索失敗。市区町村名のみで検索...');
        const cityOnlyMatch = Object.entries(codeData).find(([code, name]) => {
            const match = name.includes(cityName);
            if (match) {
                console.log('市区町村名一致:', name, '→', code);
            }
            return match;
        });

        if (cityOnlyMatch) {
            return cityOnlyMatch[1];
        }

        throw new Error('市区町村コードが見つかりませんでした');
    } catch (error) {
        console.error('市区町村コード取得エラー:', error);
        // フォールバック: 主要都市のコードマッピング
        return await fallbackCityCode(lat, lng);
    }
}

// フォールバック: 主要都市の座標から推定
async function fallbackCityCode(lat, lng) {
    // 全都道府県の県庁所在地の座標とコードのマッピング
    const majorCities = [
        { code: '011002', lat: 43.0642, lng: 141.3469, name: '北海道札幌市' },
        { code: '022012', lat: 40.8244, lng: 140.7400, name: '青森県青森市' },
        { code: '032018', lat: 39.7036, lng: 141.1527, name: '岩手県盛岡市' },
        { code: '041009', lat: 38.2682, lng: 140.8694, name: '宮城県仙台市' },
        { code: '052019', lat: 39.7186, lng: 140.1024, name: '秋田県秋田市' },
        { code: '062014', lat: 38.2404, lng: 140.3633, name: '山形県山形市' },
        { code: '072079', lat: 37.7503, lng: 140.4676, name: '福島県福島市' },
        { code: '082015', lat: 36.3418, lng: 140.4468, name: '茨城県水戸市' },
        { code: '092011', lat: 36.5657, lng: 139.8836, name: '栃木県宇都宮市' },
        { code: '102016', lat: 36.3911, lng: 139.0608, name: '群馬県前橋市' },
        { code: '111007', lat: 35.8569, lng: 139.6489, name: '埼玉県さいたま市' },
        { code: '121002', lat: 35.6047, lng: 140.1233, name: '千葉県千葉市' },
        { code: '131016', lat: 35.6895, lng: 139.6917, name: '東京都千代田区' },
        { code: '141003', lat: 35.4437, lng: 139.6380, name: '神奈川県横浜市' },
        { code: '151009', lat: 37.9026, lng: 139.0237, name: '新潟県新潟市' },
        { code: '162027', lat: 36.6953, lng: 137.2113, name: '富山県富山市' },
        { code: '172014', lat: 36.5946, lng: 136.6256, name: '石川県金沢市' },
        { code: '182010', lat: 36.0651, lng: 136.2216, name: '福井県福井市' },
        { code: '192015', lat: 35.6638, lng: 138.5684, name: '山梨県甲府市' },
        { code: '202011', lat: 36.6513, lng: 138.1810, name: '長野県長野市' },
        { code: '212016', lat: 35.3912, lng: 136.7222, name: '岐阜県岐阜市' },
        { code: '221309', lat: 34.9769, lng: 138.3831, name: '静岡県静岡市' },
        { code: '231002', lat: 35.1815, lng: 136.9066, name: '愛知県名古屋市' },
        { code: '242021', lat: 34.7303, lng: 136.5086, name: '三重県津市' },
        { code: '252018', lat: 35.0044, lng: 135.8686, name: '滋賀県大津市' },
        { code: '261009', lat: 35.0116, lng: 135.7681, name: '京都府京都市' },
        { code: '271004', lat: 34.6937, lng: 135.5023, name: '大阪府大阪市' },
        { code: '281000', lat: 34.6901, lng: 135.1955, name: '兵庫県神戸市' },
        { code: '292010', lat: 34.6851, lng: 135.8050, name: '奈良県奈良市' },
        { code: '302015', lat: 34.2261, lng: 135.1675, name: '和歌山県和歌山市' },
        { code: '312011', lat: 35.5014, lng: 134.2377, name: '鳥取県鳥取市' },
        { code: '322016', lat: 35.4723, lng: 133.0505, name: '島根県松江市' },
        { code: '331007', lat: 34.6617, lng: 133.9345, name: '岡山県岡山市' },
        { code: '341002', lat: 34.3965, lng: 132.4596, name: '広島県広島市' },
        { code: '352012', lat: 34.1858, lng: 131.4706, name: '山口県山口市' },
        { code: '362018', lat: 34.0658, lng: 134.5595, name: '徳島県徳島市' },
        { code: '372013', lat: 34.3401, lng: 134.0434, name: '香川県高松市' },
        { code: '382019', lat: 33.8416, lng: 132.7657, name: '愛媛県松山市' },
        { code: '392014', lat: 33.5597, lng: 133.5311, name: '高知県高知市' },
        { code: '401307', lat: 33.6064, lng: 130.4183, name: '福岡県福岡市' },
        { code: '412015', lat: 33.2495, lng: 130.2993, name: '佐賀県佐賀市' },
        { code: '422011', lat: 32.7503, lng: 129.8777, name: '長崎県長崎市' },
        { code: '431001', lat: 32.7898, lng: 130.7417, name: '熊本県熊本市' },
        { code: '442011', lat: 33.2382, lng: 131.6126, name: '大分県大分市' },
        { code: '452017', lat: 31.9111, lng: 131.4239, name: '宮崎県宮崎市' },
        { code: '462012', lat: 31.5602, lng: 130.5581, name: '鹿児島県鹿児島市' },
        { code: '472018', lat: 26.2124, lng: 127.6809, name: '沖縄県那覇市' },
    ];

    // 最も近い都市を見つける
    let nearest = majorCities[0];
    let minDistance = calculateDistance(lat, lng, nearest.lat, nearest.lng);

    for (const city of majorCities) {
        const distance = calculateDistance(lat, lng, city.lat, city.lng);
        if (distance < minDistance) {
            minDistance = distance;
            nearest = city;
        }
    }

    console.log('フォールバック: 最寄りの県庁所在地', nearest.name, nearest.code, '距離:', Math.round(minDistance / 1000), 'km');
    return nearest.code;
}

// 避難所データ取得
async function fetchShelters() {
    if (!state.userLocation) {
        throw new Error('位置情報が取得されていません');
    }

    // 市区町村コードを取得
    const cityCode = await getCityCode(state.userLocation.lat, state.userLocation.lng);
    console.log('市区町村コード:', cityCode);

    // 避難所データを取得（緊急避難場所と指定避難所の両方を試す）
    const types = ['emergency', 'evacuation'];

    for (const type of types) {
        try {
            const response = await fetch(
                `https://motohasystem.github.io/jp-shelter-api/api/v0/${type}/${cityCode}.json`
            );

            if (!response.ok) {
                continue;
            }

            const data = await response.json();

            if (data.features && data.features.length > 0) {
                state.shelters = data.features;
                console.log(`${type}データ取得成功:`, state.shelters.length, '件');
                break;
            }
        } catch (error) {
            console.error(`${type}データ取得エラー:`, error);
        }
    }

    if (state.shelters.length === 0) {
        throw new Error('この地域の避難所データが見つかりませんでした');
    }

    // 最寄りの避難所を計算
    findNearestShelter();
}

// 最寄りの避難所を見つける（3件）
function findNearestShelter() {
    if (!state.userLocation || state.shelters.length === 0) {
        return;
    }

    // 全避難所の距離を計算
    const sheltersWithDistance = state.shelters.map(shelter => {
        const [lng, lat] = shelter.geometry.coordinates;
        const distance = calculateDistance(
            state.userLocation.lat,
            state.userLocation.lng,
            lat,
            lng
        );

        return {
            ...shelter,
            distance: distance,
            lat: lat,
            lng: lng
        };
    });

    // 距離順にソートして上位3件を取得
    sheltersWithDistance.sort((a, b) => a.distance - b.distance);
    state.nearestShelters = sheltersWithDistance.slice(0, 3);

    console.log('最寄りの避難所3件:', state.nearestShelters.map(s => ({
        name: s.properties.name || s.properties['名称'],
        distance: Math.round(s.distance) + 'm'
    })));

    updateShelterInfo();
}

// DeviceOrientation APIセットアップ
async function setupDeviceOrientation() {
    if (!window.DeviceOrientationEvent) {
        throw new Error('DeviceOrientation APIがサポートされていません');
    }

    // iOS 13以降は許可が必要
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission !== 'granted') {
                throw new Error('DeviceOrientationの許可が拒否されました');
            }
        } catch (error) {
            showError('コンパスの使用許可が必要です');
            elements.calibrateBtn.style.display = 'block';
            elements.calibrateBtn.onclick = async () => {
                try {
                    const permission = await DeviceOrientationEvent.requestPermission();
                    if (permission === 'granted') {
                        elements.calibrateBtn.style.display = 'none';
                        startTracking();
                    }
                } catch (err) {
                    showError('許可の取得に失敗しました');
                }
            };
            throw error;
        }
    }
}

// トラッキング開始
function startTracking() {
    window.addEventListener('deviceorientation', handleOrientation);

    // 位置情報の継続的な監視
    navigator.geolocation.watchPosition(
        (position) => {
            state.userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            findNearestShelter();
        },
        (error) => {
            console.error('位置情報の更新エラー:', error);
        },
        {
            enableHighAccuracy: true,
            maximumAge: 30000,
            timeout: 27000
        }
    );
}

// デバイスの向き変更ハンドラ
function handleOrientation(event) {
    // alphaは北を0度として時計回りに360度
    let heading = event.alpha;

    // webkitCompassHeadingがある場合はそちらを使用（iOS）
    if (event.webkitCompassHeading) {
        heading = event.webkitCompassHeading;
    }

    if (heading !== null) {
        // センサーの値を反転（端末を時計回りに回すと、針が反時計回りに回転するように）
        state.deviceHeading = 360 - heading;
        updateArrow();
    }
}

// 矢印の更新（円形配置）
function updateArrow() {
    if (state.nearestShelters.length === 0 || !state.userLocation) {
        return;
    }

    // コンパス針を更新（常に北を指す）
    updateCompassNeedle();

    // 円の半径（CSSと合わせる: 280px / 2 = 140px から矢印サイズ分を引く）
    const radius = 100; // ピクセル

    // 各避難所への矢印を更新
    state.nearestShelters.forEach((shelter, index) => {
        const arrowWrapper = elements.arrows[index]?.parentElement;
        if (!arrowWrapper) return;

        // 避難所への方角を計算
        const bearing = calculateBearing(
            state.userLocation.lat,
            state.userLocation.lng,
            shelter.lat,
            shelter.lng
        );

        // デバイスの向きを考慮した相対角度
        // bearing - deviceHeading で、デバイスから見た避難所の方向
        const targetAngle = bearing - state.deviceHeading;

        // 最短経路で回転するための累積角度を計算
        state.arrowRotations[index] = getShortestRotation(state.arrowRotations[index], targetAngle);

        // 円周上に配置
        // translate(-50%, -50%): 中心を基準点に
        // rotate(angle): 指定角度の方向へ回転
        // translateY(-radius): 上方向（0度方向）に移動
        arrowWrapper.style.transform = `
            translate(-50%, -50%)
            rotate(${state.arrowRotations[index]}deg)
            translateY(-${radius}px)
        `;

        // ラベルに距離を表示
        if (elements.arrowLabels[index]) {
            elements.arrowLabels[index].textContent = formatDistance(shelter.distance);
        }

        console.log(`矢印${index + 1}: 方角=${Math.round(bearing)}°, デバイス=${Math.round(state.deviceHeading)}°, 相対=${Math.round(targetAngle)}°, 累積=${Math.round(state.arrowRotations[index])}°`);
    });
}

// コンパス針の更新（常に北を指す）
function updateCompassNeedle() {
    if (!elements.compassNeedle) return;

    // デバイスの向きと逆方向に回転させることで、常に北を指す
    const targetAngle = -state.deviceHeading;

    // 最短経路で回転するための累積角度を計算
    state.compassRotation = getShortestRotation(state.compassRotation, targetAngle);

    // 中心配置を維持しながら回転
    elements.compassNeedle.style.transform = `translate(-50%, -50%) rotate(${state.compassRotation}deg)`;
}

// 方角のテキスト取得
function getDirectionText(bearing) {
    const directions = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
    const index = Math.round(bearing / 45) % 8;
    return `${directions[index]} (${Math.round(bearing)}°)`;
}

// 避難所情報の表示更新（3件）
function updateShelterInfo() {
    if (state.nearestShelters.length === 0) {
        return;
    }

    // カード形式で3件の情報を表示
    const cardsHTML = state.nearestShelters.map((shelter, index) => {
        const props = shelter.properties;
        const name = props.name || props['名称'] || '名称不明';
        const address = props.address || props['住所'] || '住所不明';
        const distance = formatDistance(shelter.distance);

        const bearing = calculateBearing(
            state.userLocation.lat,
            state.userLocation.lng,
            shelter.lat,
            shelter.lng
        );
        const direction = getDirectionText(bearing);

        const colors = ['#ff3333', '#ff8833', '#ffbb33'];
        const labels = ['最寄り', '2番目', '3番目'];

        return `
            <div class="shelter-card" style="border-left: 4px solid ${colors[index]}">
                <div class="shelter-rank">${labels[index]}</div>
                <div class="shelter-name">${name}</div>
                <div class="shelter-details">
                    <div class="detail-item">
                        <span class="detail-label">距離</span>
                        <span class="detail-value">${distance}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">方角</span>
                        <span class="detail-value">${direction}</span>
                    </div>
                </div>
                <div class="shelter-address">${address}</div>
            </div>
        `;
    }).join('');

    elements.shelterCards.innerHTML = cardsHTML;
}

// 距離のフォーマット
function formatDistance(meters) {
    if (meters < 1000) {
        return `${Math.round(meters)}m`;
    } else {
        return `${(meters / 1000).toFixed(1)}km`;
    }
}

// 角度の最短経路を計算（360度境界問題対策）
function getShortestRotation(currentRotation, targetAngle) {
    // 現在の累積回転角度を0-360の範囲に正規化
    const normalizedCurrent = currentRotation % 360;

    // 目標角度との差分を計算
    let diff = targetAngle - normalizedCurrent;

    // -180〜180の範囲に正規化（最短経路）
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;

    // 新しい累積回転角度を返す
    return currentRotation + diff;
}

// 2点間の距離を計算（Haversine公式）
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371e3; // 地球の半径（メートル）
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// 方位角を計算
function calculateBearing(lat1, lng1, lat2, lng2) {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
              Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    bearing = (bearing + 360) % 360;

    return bearing;
}

// ステータス更新
function updateStatus(message) {
    elements.status.textContent = message;
    elements.status.classList.add('loading');
}

// エラー表示
function showError(message) {
    elements.error.textContent = message;
    elements.error.style.display = 'block';
    elements.status.textContent = 'エラーが発生しました';
    elements.status.classList.remove('loading');
    console.error(message);
}

// アプリ起動
init();
