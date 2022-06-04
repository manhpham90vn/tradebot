const ccxt = require('ccxt')
const moment = require('moment')
const delay = require('delay')
const dotenv = require('dotenv')

// config env
dotenv.config()

// cons
const SYMBOL = 'GMT/USDT'
const ENABLE_TRADE = false
const LEVERAGE = 10
const DELAY = 3000 // 3s

const COUNT_DATA_ONE_MINUTE = 5
const PROFIT_PRICE = 2
const STOP_LOSS = 2

// api key
const binanceExchange = new ccxt.binanceusdm({
    apiKey: process.env.APIKEY,
    secret: process.env.SECRET,
    options: {
        'defaultType': 'future'
    },
    rateLimit: true
});

async function getInfo() {
    // load markets and settings for trade
    const markets = await binanceExchange.loadMarkets()
    const market = await binanceExchange.market(SYMBOL)
    const set = await binanceExchange.fapiPrivatePostLeverage({
        'symbol': market.id,
        'leverage': LEVERAGE
    })

    // get total usdt
    const balance = await binanceExchange.fetchBalance();
    const totalUSDT = balance.total.USDT
    console.log(`Total USDT: ${totalUSDT}`)

    // analytics in 60m
    const result = await analytics(SYMBOL, '1m', COUNT_DATA_ONE_MINUTE)
    console.log(result)
    const average = (result.hight + result.low) / 2
    console.log(`Hight: ${result.hight} Low: ${result.low} Average: ${average} Current: ${result.lastPrice}`)

    // get positions
    const positions = balance.info.positions
    var hadPosition = false
    for (let i = 0; i < positions.length; i++) {
        const position = positions[i]
        if (position.positionAmt > 0) {
            console.log(position)
            hadPosition = true
            let unrealizedProfit = position.unrealizedProfit
            if (unrealizedProfit >= PROFIT_PRICE || unrealizedProfit <= -STOP_LOSS) {
                binanceExchange.cancelAllOrders(SYMBOL)
            }
            break
        }
        hadPosition = false
    }
    if (!hadPosition && ENABLE_TRADE) {
        order(totalUSDT, average, lastPrice)
    }
}

async function analytics(SYMBOL, time, COUNT) {
    const priceResponse = await binanceExchange.fetchOHLCV(SYMBOL, time, undefined, COUNT)
    const priceObject = priceResponse.map(price => {
        return {
            timestamp: moment(price[0]).format(),
            open: price[1],
            hight: price[2],
            low: price[3],
            close: price[4],
            volume: price[5]
        }
    })
    const hight = Math.max(...priceObject.map(e => e.hight))
    const low = Math.min(...priceObject.map(e => e.low))
    const lastPrice = priceObject[priceResponse.length - 1].close
    return { hight: hight, low: low, lastPrice: lastPrice }
}

async function order(totalUSDT, average, lastPrice) {
    const amount = 0.9 * totalUSDT * LEVERAGE
    const direction = lastPrice > average ? 'sell' : 'buy'
    const order = await binanceExchange.createOrder(SYMBOL, 'market', direction, amount)
    console.log(order)
}

async function main() {
    while (true) {
        await getInfo()
        await delay(DELAY)
        console.log(`------------------------------------------------------------`)
    }
}

main()