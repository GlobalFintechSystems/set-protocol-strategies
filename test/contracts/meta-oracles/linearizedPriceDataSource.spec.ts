require('module-alias/register');

import * as _ from 'lodash';
import * as ABIDecoder from 'abi-decoder';
import * as chai from 'chai';
import * as setProtocolUtils from 'set-protocol-utils';

import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import { MedianContract } from 'set-protocol-contracts';
import {
  LinearizedPriceDataSourceContract,
  DataFeedMockContract,
} from '@utils/contracts';
import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS,
  ZERO,
} from '@utils/constants';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';
import { LogMedianizerUpdated } from '@utils/contract_logs/linearizedPriceDataSource';

import { OracleWrapper } from '@utils/wrappers/oracleWrapper';
import { LibraryMockWrapper } from '@utils/wrappers/libraryMockWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const LinearizedPriceDataSource = artifacts.require('LinearizedPriceDataSource');
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('LinearizedPriceDataSource', accounts => {
  const [
    deployerAccount,
    medianizerAccount,
    nonOwnerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let linearizedDataSource: LinearizedPriceDataSourceContract;

  const oracleWrapper = new OracleWrapper(deployerAccount);
  const libraryMockWrapper = new LibraryMockWrapper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(LinearizedPriceDataSource.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(LinearizedPriceDataSource.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleWrapper.deployMedianizerAsync();
    await oracleWrapper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectUpdateTolerance: BigNumber;
    let subjectMedianizerAddress: Address;
    let subjectDataDescription: string;

    beforeEach(async () => {
      subjectUpdateTolerance = ONE_DAY_IN_SECONDS;
      subjectMedianizerAddress = ethMedianizer.address;
      subjectDataDescription = '200DailyETHPrice';
    });

    async function subject(): Promise<LinearizedPriceDataSourceContract> {
      return oracleWrapper.deployLinearizedPriceDataSourceAsync(
        subjectMedianizerAddress,
        subjectUpdateTolerance,
        subjectDataDescription,
      );
    }

    it('sets the correct updateTolerance', async () => {
      linearizedDataSource = await subject();

      const actualUpdateTolerance = await linearizedDataSource.updateTolerance.callAsync();

      expect(actualUpdateTolerance).to.be.bignumber.equal(subjectUpdateTolerance);
    });

    it('sets the correct medianizer address', async () => {
      linearizedDataSource = await subject();

      const actualMedianizerAddress = await linearizedDataSource.medianizerInstance.callAsync();

      expect(actualMedianizerAddress).to.equal(subjectMedianizerAddress);
    });

    it('sets the correct data description', async () => {
      linearizedDataSource = await subject();

      const actualDataDescription = await linearizedDataSource.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });
  });

  describe('#read', async () => {
    let newEthPrice: BigNumber;
    let updateTolerance: BigNumber;
    let updatePeriod;

    const seedValues: BigNumber[] = [ether(100)];
    const maxDataPoints = new BigNumber(200);
    const dataDescription = 'ETH Daily Price';

    let dataFeedMock: DataFeedMockContract;

    let subjectTimeFastForward: BigNumber;

    let customEtherPrice: BigNumber;

    beforeEach(async () => {
      newEthPrice = customEtherPrice || ether(200);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        newEthPrice,
        SetTestUtils.generateTimestamp(1000)
      );

      updateTolerance = ONE_DAY_IN_SECONDS;
      const medianizerAddress = ethMedianizer.address;
      linearizedDataSource = await oracleWrapper.deployLinearizedPriceDataSourceAsync(
        medianizerAddress,
        updateTolerance,
      );

      updatePeriod = ONE_DAY_IN_SECONDS;
      dataFeedMock = await libraryMockWrapper.deployDataFeedMockAsync(
        linearizedDataSource.address,
        updatePeriod,
        maxDataPoints,
        dataDescription,
        seedValues,
      );

      subjectTimeFastForward = ONE_DAY_IN_SECONDS;
    });

    async function subject(): Promise<BigNumber> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);

      // Send dummy transaction to advance block
      await web3.eth.sendTransaction({
        from: deployerAccount,
        to: deployerAccount,
        value: ether(1).toString(),
        gas: DEFAULT_GAS,
      });

      return dataFeedMock.testCallDataSource.callAsync();
    }

    it('updates the linearizedDataSource with the correct price', async () => {
      const actualPrice = await subject();

      const expectedPrice = newEthPrice;

      expect(actualPrice).to.bignumber.equal(expectedPrice);
    });

    describe('when the update time has not been passed', async () => {

      beforeEach(async () => {
        subjectTimeFastForward = ZERO;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when the timestamp has surpassed the updateTolerance and price increases', async () => {
      beforeEach(async () => {
        subjectTimeFastForward = ONE_DAY_IN_SECONDS.mul(3);
      });

      it('returns with the correct interpolated value', async () => {
        const nextAvailableUpdate = await dataFeedMock.nextAvailableUpdate.callAsync();
        const lastUpdateTimestamp = nextAvailableUpdate.sub(updatePeriod);

        const actualNewPrice = await subject();

        const pokeBlock = await web3.eth.getBlock('latest');
        const pokeBlockTimestamp = new BigNumber(pokeBlock.timestamp);

        const [initialEthPrice] = await dataFeedMock.read.callAsync(new BigNumber(1));
        const timeFromExpectedUpdate = pokeBlockTimestamp.sub(nextAvailableUpdate);
        const timeFromLastUpdate = pokeBlockTimestamp.sub(lastUpdateTimestamp);
        const expectedNewPrice = newEthPrice
                                     .mul(updatePeriod)
                                     .add(initialEthPrice.mul(timeFromExpectedUpdate))
                                     .div(timeFromLastUpdate)
                                     .round(0, 3);

        expect(actualNewPrice).to.bignumber.equal(expectedNewPrice);
      });
    });

    describe('when the timestamp has surpassed the updateTolerance and price decreases', async () => {
      before(async () => {
        customEtherPrice = new BigNumber(50);
      });

      after(async () => {
        customEtherPrice = undefined;
      });

      beforeEach(async () => {
        subjectTimeFastForward = ONE_DAY_IN_SECONDS.mul(3);
      });

      it('returns with the correct interpolated value', async () => {
        const nextAvailableUpdate = await dataFeedMock.nextAvailableUpdate.callAsync();
        const lastUpdateTimestamp = nextAvailableUpdate.sub(updatePeriod);

        const actualNewPrice = await subject();

        const pokeBlock = await web3.eth.getBlock('latest');
        const pokeBlockTimestamp = new BigNumber(pokeBlock.timestamp);

        const [initialEthPrice] = await dataFeedMock.read.callAsync(new BigNumber(1));
        const timeFromExpectedUpdate = pokeBlockTimestamp.sub(nextAvailableUpdate);
        const timeFromLastUpdate = pokeBlockTimestamp.sub(lastUpdateTimestamp);
        const expectedNewPrice = newEthPrice
                                     .mul(updatePeriod)
                                     .add(initialEthPrice.mul(timeFromExpectedUpdate))
                                     .div(timeFromLastUpdate)
                                     .round(0, 3);

        expect(actualNewPrice).to.bignumber.equal(expectedNewPrice);
      });
    });
  });

  describe('#changeMedianizer', async () => {
    let ethPrice: BigNumber;

    let subjectNewMedianizer: Address;
    let subjectCaller: Address;

    beforeEach(async () => {
      ethPrice = ether(150);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        SetTestUtils.generateTimestamp(1000),
      );

      const medianizerAddress = ethMedianizer.address;
      linearizedDataSource = await oracleWrapper.deployLinearizedPriceDataSourceAsync(
        medianizerAddress,
      );

      subjectNewMedianizer = medianizerAccount;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return linearizedDataSource.changeMedianizer.sendTransactionAsync(
        subjectNewMedianizer,
        {
          from: subjectCaller,
          gas: DEFAULT_GAS,
        }
      );
    }

    it('updates the medianizer address', async () => {
      await subject();

      const actualMedianizerAddress = await linearizedDataSource.medianizerInstance.callAsync();

      expect(actualMedianizerAddress).to.equal(subjectNewMedianizer);
    });

    it('emits correct LogMedianizerUpdated event', async () => {
      const txHash = await subject();

      const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
      const expectedLogs = LogMedianizerUpdated(
        subjectNewMedianizer,
        linearizedDataSource.address
      );

      await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
    });

    describe('when non owner calls', async () => {
      beforeEach(async () => {
        subjectCaller = nonOwnerAccount;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});