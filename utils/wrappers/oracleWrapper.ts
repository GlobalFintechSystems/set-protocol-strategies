import * as _ from 'lodash';
import * as setProtocolUtils from 'set-protocol-utils';
import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import { MedianContract } from 'set-protocol-contracts';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';

import {
  HistoricalPriceFeedV2Contract,
  FeedFactoryContract,
  HistoricalPriceFeedContract,
  MovingAverageOracleContract,
  PriceFeedContract,
} from '../contracts';
import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS,
} from '@utils/constants';
import { getWeb3 } from '../web3Helper';
import { FeedCreatedArgs } from '../contract_logs/oracle';

const web3 = getWeb3();
const HistoricalPriceFeedV2 = artifacts.require('HistoricalPriceFeedV2');
const HistoricalPriceFeed = artifacts.require('HistoricalPriceFeed');
const FeedFactory = artifacts.require('FeedFactory');
const Median = artifacts.require('Median');
const MovingAverageOracle = artifacts.require('MovingAverageOracle');

const { SetProtocolTestUtils: SetTestUtils, SetProtocolUtils: SetUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);
const setUtils = new SetUtils(web3);


export class OracleWrapper {
  private _contractOwnerAddress: Address;
  private _blockchain: Blockchain;

  constructor(contractOwnerAddress: Address) {
    this._contractOwnerAddress = contractOwnerAddress;
    this._blockchain = new Blockchain(web3);
  }

  /* ============ Deployment ============ */

  public async deployFeedFactoryAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<FeedFactoryContract> {
    const feedFactory = await FeedFactory.new(
      { from },
    );

    return new FeedFactoryContract(
      new web3.eth.Contract(feedFactory.abi, feedFactory.address),
      { from },
    );
  }

  public async deployPriceFeedAsync(
    feedFactory: FeedFactoryContract,
    from: Address = this._contractOwnerAddress
  ): Promise<PriceFeedContract> {
    const txHash = await feedFactory.create.sendTransactionAsync(
      { from },
    );

    const logs = await setTestUtils.getLogsFromTxHash(txHash);
    const createLog = logs[logs.length - 1];
    const args: FeedCreatedArgs = createLog.args;

    return await PriceFeedContract.at(
      args.feed,
      web3,
      { from }
    );
  }

  public async deployMedianizerAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<MedianContract> {
    const medianizer = await Median.new(
      { from },
    );

    return new MedianContract(
      new web3.eth.Contract(medianizer.abi, medianizer.address),
      { from },
    );
  }

  public async deployHistoricalPriceFeedAsync(
    updateFrequency: BigNumber,
    medianizerAddress: Address,
    dataDescription: string,
    seededValues: BigNumber[],
    from: Address = this._contractOwnerAddress
  ): Promise<HistoricalPriceFeedContract> {
    const historicalPriceFeed = await HistoricalPriceFeed.new(
      updateFrequency,
      medianizerAddress,
      dataDescription,
      seededValues,
      { from },
    );

    return new HistoricalPriceFeedContract(
      new web3.eth.Contract(historicalPriceFeed.abi, historicalPriceFeed.address),
      { from },
    );
  }

  public async deployHistoricalPriceFeedV2Async(
    medianizerAddress: Address,
    updateFrequency: BigNumber = ONE_DAY_IN_SECONDS,
    updateTolerance: BigNumber = ONE_DAY_IN_SECONDS.div(4),
    maxDataPoints: BigNumber = new BigNumber(200),
    dataDescription: string = '200DailyETHPrice',
    seededValues: BigNumber[] = [],
    from: Address = this._contractOwnerAddress
  ): Promise<HistoricalPriceFeedV2Contract> {
    const historicalPriceFeed = await HistoricalPriceFeedV2.new(
      updateFrequency,
      updateTolerance,
      maxDataPoints,
      medianizerAddress,
      dataDescription,
      seededValues,
      { from },
    );

    return new HistoricalPriceFeedV2Contract(
      new web3.eth.Contract(historicalPriceFeed.abi, historicalPriceFeed.address),
      { from },
    );
  }

  public async deployMovingAverageOracleAsync(
    priceFeedAddress: Address,
    dataDescription: string,
    from: Address = this._contractOwnerAddress
  ): Promise<MovingAverageOracleContract> {
    const movingAverageOracle = await MovingAverageOracle.new(
      priceFeedAddress,
      dataDescription,
      { from },
    );

    return new MovingAverageOracleContract(
      new web3.eth.Contract(movingAverageOracle.abi, movingAverageOracle.address),
      { from },
    );
  }

  /* ============ Transactions ============ */

  public async addPriceFeedOwnerToMedianizer(
    medianizer: MedianContract,
    priceFeedSigner: Address,
    from: Address = this._contractOwnerAddress
  ): Promise<string> {
    return await medianizer.lift.sendTransactionAsync(
      priceFeedSigner,
      { from },
    );
  }

  public async setMedianizerMinimumQuorumAsync(
    medianizer: MedianContract,
    minimum: number,
    from: Address = this._contractOwnerAddress
  ): Promise<string> {
    return await medianizer.setMin.sendTransactionAsync(
      new BigNumber(minimum),
      { from },
    );
  }

  public async updatePriceFeedAsync(
    priceFeed: PriceFeedContract,
    price: BigNumber,
    timeStamp: BigNumber,
    from: Address = this._contractOwnerAddress
  ): Promise<string> {
    return await priceFeed.poke.sendTransactionAsync(
      price,
      timeStamp,
      { from },
    );
  }

  /*
    This is disconnected from the v1 system where price feeds are updated first and then
    the medianizer reads from each price feed to determine the median. In the new system,
    The oracles are off chain, sign their price updates, and then send them all to the medianizer
    which now expects N (new prices, timestamps, signatures)

    Makes a number of assumptions:
    1. Price update is signed by ownerAccount
    2. Only one price is used to update the price
    3. Only one timestmap is used to update the timestamp
    4. Quorum on price feed is 1
    4. OwnerAccount is added as approved oracle on medianizer
  */
  public async updateMedianizerPriceAsync(
    medianizer: MedianContract,
    price: BigNumber,
    timestamp: BigNumber,
    from: Address = this._contractOwnerAddress
  ): Promise<string> {
    const standardSignature = SetUtils.hashPriceFeedHex(price, timestamp);
    const ecSignature = await setUtils.signMessage(standardSignature, from);

    return await medianizer.poke.sendTransactionAsync(
      [price],
      [timestamp],
      [new BigNumber(ecSignature.v)],
      [ecSignature.r],
      [ecSignature.s],
      { from }
    );
  }

  public async updateHistoricalPriceFeedAsync(
    dailyPriceFeed: HistoricalPriceFeedContract,
    medianizer: MedianContract,
    price: BigNumber,
    from: Address = this._contractOwnerAddress
  ): Promise<void> {
    await this._blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);

    const lastBlock = await web3.eth.getBlock('latest');
    await this.updateMedianizerPriceAsync(
      medianizer,
      price,
      lastBlock.timestamp + 1,
    );

    await dailyPriceFeed.poke.sendTransactionAsync(
      { gas: DEFAULT_GAS},
    );
  }

  public async batchUpdateHistoricalPriceFeedAsync(
    dailyPriceFeed: HistoricalPriceFeedContract,
    medianizer: MedianContract,
    daysOfData: number,
    priceArray: BigNumber[] = undefined,
    from: Address = this._contractOwnerAddress
  ): Promise<BigNumber[]> {

    if (!priceArray) {
      priceArray = Array.from({length: daysOfData}, () => ether(Math.floor(Math.random() * 100) + 100));
    }

    let i: number;
    for (i = 0; i < priceArray.length; i++) {
      await this.updateHistoricalPriceFeedAsync(
        dailyPriceFeed,
        medianizer,
        priceArray[i],
      );
    }

    return priceArray;
  }

  public async updateHistoricalPriceFeedV2Async(
    dailyPriceFeed: HistoricalPriceFeedV2Contract,
    medianizer: MedianContract,
    price: BigNumber,
    from: Address = this._contractOwnerAddress
  ): Promise<void> {
    await this._blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);

    const lastBlock = await web3.eth.getBlock('latest');
    await this.updateMedianizerPriceAsync(
      medianizer,
      price,
      lastBlock.timestamp + 1,
    );

    await dailyPriceFeed.poke.sendTransactionAsync(
      { gas: DEFAULT_GAS},
    );
  }

  public async batchUpdateHistoricalPriceFeedV2Async(
    dailyPriceFeed: HistoricalPriceFeedV2Contract,
    medianizer: MedianContract,
    daysOfData: number,
    priceArray: BigNumber[] = undefined,
    from: Address = this._contractOwnerAddress
  ): Promise<BigNumber[]> {

    if (!priceArray) {
      priceArray = Array.from({length: daysOfData}, () => ether(Math.floor(Math.random() * 100) + 100));
    }

    let i: number;
    for (i = 0; i < priceArray.length; i++) {
      await this.updateHistoricalPriceFeedV2Async(
        dailyPriceFeed,
        medianizer,
        priceArray[i],
      );
    }

    return priceArray;
  }
}
