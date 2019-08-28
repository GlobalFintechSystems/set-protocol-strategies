require('module-alias/register');

import * as _ from 'lodash';
import * as ABIDecoder from 'abi-decoder';
import * as chai from 'chai';
import * as setProtocolUtils from 'set-protocol-utils';
import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import {
  Core,
  CoreContract,
  LinearAuctionPriceCurveContract,
  MedianContract,
  SetTokenContract,
  RebalanceAuctionModuleContract,
  RebalancingSetToken,
  RebalancingSetTokenContract,
  RebalancingSetTokenFactoryContract,
  SetTokenFactoryContract,
  StandardTokenMockContract,
  TransferProxyContract,
} from 'set-protocol-contracts';
import {
  BTCDaiRebalancingManagerContract,
} from '@utils/contracts';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS,
} from '@utils/constants';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';
import { LogManagerProposal } from '@utils/contract_logs/btcDaiRebalancingManager';

import { ProtocolHelper } from '@utils/helpers/protocolHelper';
import { ERC20Helper } from '@utils/helpers/erc20Helper';
import { OracleHelper } from '@utils/helpers/oracleHelper';
import { ManagerHelper } from '@utils/helpers/managerHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const BTCDaiRebalancingManager = artifacts.require('BTCDaiRebalancingManager');
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('BTCDaiRebalancingManager', accounts => {
  const [
    deployerAccount,
    otherAccount,
  ] = accounts;

  let rebalancingSetToken: RebalancingSetTokenContract;

  let core: CoreContract;
  let transferProxy: TransferProxyContract;
  let rebalanceAuctionModule: RebalanceAuctionModuleContract;
  let factory: SetTokenFactoryContract;
  let rebalancingFactory: RebalancingSetTokenFactoryContract;
  let linearAuctionPriceCurve: LinearAuctionPriceCurveContract;
  let btcDaiRebalancingManager: BTCDaiRebalancingManagerContract;
  let btcMedianizer: MedianContract;
  let daiMock: StandardTokenMockContract;
  let wrappedBTC: StandardTokenMockContract;

  const protocolHelper = new ProtocolHelper(deployerAccount);
  const erc20Helper = new ERC20Helper(deployerAccount);
  const managerHelper = new ManagerHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(Core.abi);
    ABIDecoder.addABI(RebalancingSetToken.abi);
    ABIDecoder.addABI(BTCDaiRebalancingManager.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(Core.abi);
    ABIDecoder.removeABI(RebalancingSetToken.abi);
    ABIDecoder.removeABI(BTCDaiRebalancingManager.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    transferProxy = await protocolHelper.getDeployedTransferProxyAsync();
    core = await protocolHelper.getDeployedCoreAsync();
    rebalanceAuctionModule = await protocolHelper.getDeployedRebalanceAuctionModuleAsync();

    factory = await protocolHelper.getDeployedSetTokenFactoryAsync();
    rebalancingFactory = await protocolHelper.getDeployedRebalancingSetTokenFactoryAsync();
    linearAuctionPriceCurve = await protocolHelper.getDeployedLinearAuctionPriceCurveAsync();

    btcMedianizer = await protocolHelper.getDeployedWBTCMedianizerAsync();
    await oracleHelper.addPriceFeedOwnerToMedianizer(btcMedianizer, deployerAccount);

    daiMock = await protocolHelper.getDeployedDAIAsync();
    wrappedBTC = await protocolHelper.getDeployedWBTCAsync();
    await erc20Helper.approveTransfersAsync(
      [daiMock, wrappedBTC],
      transferProxy.address
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectCoreAddress: Address;
    let subjectBtcPriceFeedAddress: Address;
    let subjectDaiAddress: Address;
    let subjectBtcAddress: Address;
    let subjectSetTokenFactory: Address;
    let subjectAuctionLibrary: Address;
    let subjectAuctionTimeToPivot: BigNumber;
    let subjectDaiMultiplier: BigNumber;
    let subjectBtcMultiplier: BigNumber;
    let subjectLowerAllocationBound: BigNumber;
    let subjectUpperAllocationBound: BigNumber;

    beforeEach(async () => {
      subjectCoreAddress = core.address;
      subjectBtcPriceFeedAddress = btcMedianizer.address;
      subjectDaiAddress = daiMock.address;
      subjectBtcAddress = wrappedBTC.address;
      subjectSetTokenFactory = factory.address;
      subjectAuctionLibrary = linearAuctionPriceCurve.address;
      subjectAuctionTimeToPivot = ONE_DAY_IN_SECONDS;
      subjectDaiMultiplier = new BigNumber(1);
      subjectBtcMultiplier = new BigNumber(1);
      subjectLowerAllocationBound = new BigNumber(48);
      subjectUpperAllocationBound = new BigNumber(52);
    });

    async function subject(): Promise<BTCDaiRebalancingManagerContract> {
      return managerHelper.deployBTCDaiRebalancingManagerAsync(
        subjectCoreAddress,
        subjectBtcPriceFeedAddress,
        subjectDaiAddress,
        subjectBtcAddress,
        subjectSetTokenFactory,
        subjectAuctionLibrary,
        subjectAuctionTimeToPivot,
        [subjectDaiMultiplier, subjectBtcMultiplier],
        [subjectLowerAllocationBound, subjectUpperAllocationBound]
      );
    }

    it('sets dai address', async () => {
      const rebalancingManager = await subject();

      const actualDaiAddress = await rebalancingManager.daiAddress.callAsync();

      expect(actualDaiAddress).to.be.equal(subjectDaiAddress);
    });

    it('sets wbtc address', async () => {
      const rebalancingManager = await subject();

      const actualBtcAddress = await rebalancingManager.btcAddress.callAsync();

      expect(actualBtcAddress).to.be.equal(subjectBtcAddress);
    });

    it('sets set token factory', async () => {
      const rebalancingManager = await subject();

      const actualSetTokenFactory = await rebalancingManager.setTokenFactory.callAsync();

      expect(actualSetTokenFactory).to.be.equal(subjectSetTokenFactory);
    });

    it('sets auction library', async () => {
      const rebalancingManager = await subject();

      const actualAuctionLibrary = await rebalancingManager.auctionLibrary.callAsync();

      expect(actualAuctionLibrary).to.be.equal(subjectAuctionLibrary);
    });

    it('sets correct auctionTimeToPivot', async () => {
      const rebalancingManager = await subject();

      const actualAuctionTimeToPivot = await rebalancingManager.auctionTimeToPivot.callAsync();

      expect(actualAuctionTimeToPivot).to.be.bignumber.eql(subjectAuctionTimeToPivot);
    });

    it('sets correct daiMultiplier', async () => {
      const rebalancingManager = await subject();

      const actualDaiMultiplier = await rebalancingManager.daiMultiplier.callAsync();

      expect(actualDaiMultiplier).to.be.bignumber.eql(subjectDaiMultiplier);
    });

    it('sets correct btcMultiplier', async () => {
      const rebalancingManager = await subject();

      const actualBtcMultiplier = await rebalancingManager.btcMultiplier.callAsync();

      expect(actualBtcMultiplier).to.be.bignumber.eql(subjectBtcMultiplier);
    });

    it('sets correct btcPriceFeed', async () => {
      const rebalancingManager = await subject();

      const btcPriceFeed = await rebalancingManager.btcPriceFeed.callAsync();

      expect(btcPriceFeed).to.be.bignumber.eql(subjectBtcPriceFeedAddress);
    });

    it('sets correct maximumLowerThreshold', async () => {
      const rebalancingManager = await subject();

      const maximumLowerThreshold = await rebalancingManager.maximumLowerThreshold.callAsync();

      expect(maximumLowerThreshold).to.be.bignumber.eql(subjectLowerAllocationBound);
    });

    it('sets correct minimumUpperThreshold', async () => {
      const rebalancingManager = await subject();

      const minimumUpperThreshold = await rebalancingManager.minimumUpperThreshold.callAsync();

      expect(minimumUpperThreshold).to.be.bignumber.eql(subjectUpperAllocationBound);
    });

    describe('when lower allocation bound is greater than upper', async () => {
      beforeEach(async () => {
        subjectLowerAllocationBound = new BigNumber(52);
        subjectUpperAllocationBound = new BigNumber(48);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#propose', async () => {
    let subjectRebalancingSetToken: Address;
    let subjectCaller: Address;
    let subjectTimeFastForward: BigNumber;

    let proposalPeriod: BigNumber;
    let daiMultiplier: BigNumber;
    let btcMultiplier: BigNumber;
    let lowerAllocationBound: BigNumber;
    let upperAllocationBound: BigNumber;
    let btcPrice: BigNumber;
    let daiUnit: BigNumber;

    const DAI_PRICE: BigNumber = new BigNumber(10 ** 18);
    const DAI_DECIMALS: BigNumber = new BigNumber(10 ** 18);
    const BTC_DECIMALS: BigNumber = new BigNumber(10 ** 8);
    const PRICE_PRECISION: BigNumber = new BigNumber(1);

    let initialAllocationToken: SetTokenContract;

    before(async () => {
      daiMultiplier = new BigNumber(1);
      btcMultiplier = new BigNumber(1);

      btcPrice = new BigNumber(3200 * 10 ** 18);
      daiUnit = new BigNumber(2800);
    });

    beforeEach(async () => {
      lowerAllocationBound = new BigNumber(48);
      upperAllocationBound = new BigNumber(52);
      btcDaiRebalancingManager = await managerHelper.deployBTCDaiRebalancingManagerAsync(
        core.address,
        btcMedianizer.address,
        daiMock.address,
        wrappedBTC.address,
        factory.address,
        linearAuctionPriceCurve.address,
        ONE_DAY_IN_SECONDS,
        [daiMultiplier, btcMultiplier],
        [lowerAllocationBound, upperAllocationBound]
      );

      const decimalDifference = DAI_DECIMALS.div(BTC_DECIMALS);
      initialAllocationToken = await protocolHelper.createSetTokenAsync(
        core,
        factory.address,
        [daiMock.address, wrappedBTC.address],
        [daiUnit.mul(daiMultiplier).mul(decimalDifference).mul(PRICE_PRECISION), btcMultiplier.mul(PRICE_PRECISION)],
        PRICE_PRECISION.mul(decimalDifference),
      );

      proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        btcDaiRebalancingManager.address,
        initialAllocationToken.address,
        proposalPeriod
      );

      subjectRebalancingSetToken = rebalancingSetToken.address;
      subjectCaller = otherAccount;
      subjectTimeFastForward = ONE_DAY_IN_SECONDS.add(1);

      await oracleHelper.updateMedianizerPriceAsync(
        btcMedianizer,
        btcPrice,
        SetTestUtils.generateTimestamp(1000),
      );

      // Issue currentSetToken
      await core.issue.sendTransactionAsync(
        initialAllocationToken.address,
        ether(9),
        {from: deployerAccount, gas: DEFAULT_GAS},
      );
      await erc20Helper.approveTransfersAsync([initialAllocationToken], transferProxy.address);

      // Use issued currentSetToken to issue rebalancingSetToken
      await core.issue.sendTransactionAsync(
        rebalancingSetToken.address,
        ether(7),
        { from: deployerAccount, gas: DEFAULT_GAS });
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return btcDaiRebalancingManager.propose.sendTransactionAsync(
        subjectRebalancingSetToken,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    describe('when proposeNewRebalance is called from the Default state', async () => {
      it('updates new set token to the correct naturalUnit', async () => {
        await subject();

        const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

        const expectedNextSetParams = managerHelper.getExpectedGeneralNextSetParameters(
          DAI_PRICE,
          btcPrice,
          daiMultiplier,
          btcMultiplier,
          DAI_DECIMALS.div(BTC_DECIMALS),
          PRICE_PRECISION,
        );

        expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
      });

      it('updates new set token to the correct units', async () => {
        await subject();

        const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetUnits = await nextSet.getUnits.callAsync();

        const expectedNextSetParams = managerHelper.getExpectedGeneralNextSetParameters(
          DAI_PRICE,
          btcPrice,
          daiMultiplier,
          btcMultiplier,
          DAI_DECIMALS.div(BTC_DECIMALS),
          PRICE_PRECISION,
        );

        expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
      });

      it('updates new set token to the correct components', async () => {
        await subject();

        const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetComponents = await nextSet.getComponents.callAsync();

        const expectedNextSetComponents = [daiMock.address, wrappedBTC.address];
        expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
      });

      it('updates to the new auction library correctly', async () => {
        await subject();

        const newAuctionLibrary = await rebalancingSetToken.auctionLibrary.callAsync();
        expect(newAuctionLibrary).to.equal(linearAuctionPriceCurve.address);
      });

      it('updates the time to pivot correctly', async () => {
        await subject();

        const auctionPriceParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
        const newAuctionTimeToPivot = auctionPriceParameters[1];
        expect(newAuctionTimeToPivot).to.be.bignumber.equal(ONE_DAY_IN_SECONDS);
      });

      it('updates the auction start price correctly', async () => {
        await subject();

        const auctionPriceParameters = await managerHelper.getExpectedGeneralAuctionParameters(
          DAI_PRICE,
          btcPrice,
          daiMultiplier,
          btcMultiplier,
          DAI_DECIMALS,
          BTC_DECIMALS,
          PRICE_PRECISION,
          ONE_DAY_IN_SECONDS,
          initialAllocationToken,
        );

        const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
        const newAuctionPivotPrice = newAuctionParameters[2];

        expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionStartPrice']);
      });

      it('updates the auction pivot price correctly', async () => {
        await subject();

        const auctionPriceParameters = await managerHelper.getExpectedGeneralAuctionParameters(
          DAI_PRICE,
          btcPrice,
          daiMultiplier,
          btcMultiplier,
          DAI_DECIMALS,
          BTC_DECIMALS,
          PRICE_PRECISION,
          ONE_DAY_IN_SECONDS,
          initialAllocationToken,
        );

        const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
        const newAuctionPivotPrice = newAuctionParameters[3];

        expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
      });

      it('emits correct LogProposal event', async () => {
        const txHash = await subject();

        const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedLogs = LogManagerProposal(
          btcPrice,
          btcDaiRebalancingManager.address
        );

        await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
      });

      describe('when the new allocation is 75/25', async () => {
        before(async () => {
          daiMultiplier = new BigNumber(3);
          btcMultiplier = new BigNumber(1);
        });

        after(async () => {
          daiMultiplier = new BigNumber(1);
          btcMultiplier = new BigNumber(1);
        });

        it('updates new set token to the correct naturalUnit', async () => {
          await subject();

          const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
          const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
          const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

          const expectedNextSetParams = managerHelper.getExpectedGeneralNextSetParameters(
            DAI_PRICE,
            btcPrice,
            daiMultiplier,
            btcMultiplier,
            DAI_DECIMALS.div(BTC_DECIMALS),
            PRICE_PRECISION,
          );
          expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
        });

        it('updates new set token to the correct units', async () => {
          await subject();

          const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
          const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
          const nextSetUnits = await nextSet.getUnits.callAsync();

          const expectedNextSetParams = managerHelper.getExpectedGeneralNextSetParameters(
            DAI_PRICE,
            btcPrice,
            daiMultiplier,
            btcMultiplier,
            DAI_DECIMALS.div(BTC_DECIMALS),
            PRICE_PRECISION,
          );

          expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
        });
      });

      describe('but the price of Dai is greater than btc', async () => {
        before(async () => {
          btcPrice = new BigNumber(7 * 10 ** 17);
          daiUnit = new BigNumber(1);
        });

        after(async () => {
          btcPrice = new BigNumber(3200 * 10 ** 18);
          daiUnit = new BigNumber(2800);
        });

        it('updates new set token to the correct naturalUnit', async () => {
          await subject();

          const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
          const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
          const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

          const expectedNextSetParams = managerHelper.getExpectedGeneralNextSetParameters(
            DAI_PRICE,
            btcPrice,
            daiMultiplier,
            btcMultiplier,
            DAI_DECIMALS.div(BTC_DECIMALS),
            PRICE_PRECISION,
          );
          expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
        });

        it('updates new set token to the correct units', async () => {
          await subject();

          const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
          const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
          const nextSetUnits = await nextSet.getUnits.callAsync();

          const expectedNextSetParams = managerHelper.getExpectedGeneralNextSetParameters(
            DAI_PRICE,
            btcPrice,
            daiMultiplier,
            btcMultiplier,
            DAI_DECIMALS.div(BTC_DECIMALS),
            PRICE_PRECISION,
          );
          expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
        });

        it('updates the auction start price correctly', async () => {
          await subject();

          const auctionPriceParameters = await managerHelper.getExpectedGeneralAuctionParameters(
            DAI_PRICE,
            btcPrice,
            daiMultiplier,
            btcMultiplier,
            DAI_DECIMALS,
            BTC_DECIMALS,
            PRICE_PRECISION,
            ONE_DAY_IN_SECONDS,
            initialAllocationToken,
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionPivotPrice = newAuctionParameters[2];

          expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionStartPrice']);
        });

        it('updates the auction pivot price correctly', async () => {
          await subject();

          const auctionPriceParameters = await managerHelper.getExpectedGeneralAuctionParameters(
            DAI_PRICE,
            btcPrice,
            daiMultiplier,
            btcMultiplier,
            DAI_DECIMALS,
            BTC_DECIMALS,
            PRICE_PRECISION,
            ONE_DAY_IN_SECONDS,
            initialAllocationToken,
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionPivotPrice = newAuctionParameters[3];

          expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
        });

        describe('but the new allocation is 75/25', async () => {
          before(async () => {
            daiMultiplier = new BigNumber(3);
            btcMultiplier = new BigNumber(1);
          });

          after(async () => {
            daiMultiplier = new BigNumber(1);
            btcMultiplier = new BigNumber(1);
          });

          it('updates new set token to the correct naturalUnit', async () => {
            await subject();

            const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
            const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

            const expectedNextSetParams = managerHelper.getExpectedGeneralNextSetParameters(
              DAI_PRICE,
              btcPrice,
              daiMultiplier,
              btcMultiplier,
              DAI_DECIMALS.div(BTC_DECIMALS),
              PRICE_PRECISION,
            );
            expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
          });

          it('updates new set token to the correct units', async () => {
            await subject();

            const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
            const nextSetUnits = await nextSet.getUnits.callAsync();

            const expectedNextSetParams = managerHelper.getExpectedGeneralNextSetParameters(
              DAI_PRICE,
              btcPrice,
              daiMultiplier,
              btcMultiplier,
              DAI_DECIMALS.div(BTC_DECIMALS),
              PRICE_PRECISION,
            );
            expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
          });
        });
      });

      describe('but the passed rebalancing set address was not created by Core', async () => {
        beforeEach(async () => {
          const unTrackedSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
            core,
            rebalancingFactory.address,
            btcDaiRebalancingManager.address,
            initialAllocationToken.address,
            proposalPeriod,
          );

          await core.disableSet.sendTransactionAsync(
            unTrackedSetToken.address,
            { from: deployerAccount, gas: DEFAULT_GAS },
          );

          subjectRebalancingSetToken = unTrackedSetToken.address;
        });

        it('should revert', async () => {
          await expectRevertError(subject());
        });
      });

      describe('but the computed token allocation is too close to the bounds', async () => {
        before(async () => {
          btcPrice = new BigNumber(2750 * 10 ** 18);
        });

        after(async () => {
          btcPrice = new BigNumber(3200 * 10 ** 18);
        });

        it('should revert', async () => {
          await expectRevertError(subject());
        });
      });

      describe('but the rebalance interval has not elapsed', async () => {
        beforeEach(async () => {
          subjectTimeFastForward = ONE_DAY_IN_SECONDS.sub(10);
        });

        it('should revert', async () => {
          await expectRevertError(subject());
        });
      });
    });

    describe('when proposeNewRebalance is called from Proposal state', async () => {
      let timeJump: BigNumber;

      beforeEach(async () => {
        await blockchain.increaseTimeAsync(subjectTimeFastForward);
        await btcDaiRebalancingManager.propose.sendTransactionAsync(
          subjectRebalancingSetToken,
        );

        timeJump = new BigNumber(1000);
        await blockchain.increaseTimeAsync(timeJump);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when proposeNewRebalance is called from Rebalance state', async () => {
      beforeEach(async () => {
        await blockchain.increaseTimeAsync(subjectTimeFastForward);
        await btcDaiRebalancingManager.propose.sendTransactionAsync(
          subjectRebalancingSetToken,
        );

        // Transition to rebalance
        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.add(1));
        await rebalancingSetToken.startRebalance.sendTransactionAsync(
          { from: otherAccount, gas: DEFAULT_GAS }
        );
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when proposeNewRebalance is called from Drawdown State', async () => {
      beforeEach(async () => {
        // propose rebalance
        await blockchain.increaseTimeAsync(subjectTimeFastForward);
        await btcDaiRebalancingManager.propose.sendTransactionAsync(
          subjectRebalancingSetToken,
        );

        // Transition to rebalance
        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.add(1));

        await rebalancingSetToken.startRebalance.sendTransactionAsync(
          { from: otherAccount, gas: DEFAULT_GAS }
        );

        const defaultTimeToPivot = new BigNumber(100000);
        await blockchain.increaseTimeAsync(defaultTimeToPivot.add(1));

        const biddingParameters = await rebalancingSetToken.biddingParameters.callAsync();
        const minimumBid = biddingParameters[0];
        await rebalanceAuctionModule.bid.sendTransactionAsync(
          rebalancingSetToken.address,
          minimumBid,
          false,
          { from: deployerAccount, gas: DEFAULT_GAS }
        );

        await rebalancingSetToken.endFailedAuction.sendTransactionAsync(
          { from: otherAccount, gas: DEFAULT_GAS}
        );
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});