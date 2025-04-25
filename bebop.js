const { ethers } = require("ethers");
const readline = require("readline");
const chalk = require("chalk");
const figlet = require("figlet");

// Constants
const CHAIN_ID = 6342;
const EXPLORER_URL_MEGAETH = "https://explorer.megaeth.systems/tx/";
const WETH_CONTRACT = "0x4eb2bd7bee16f38b1f4a0a5796fffd028b6040e9";
const SPENDER_CONTRACT = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const ROUTER_CONTRACT = "0xbeb0b0623f66be8ce162ebdfa2ec543a522f4ea6";
const CUSD_CONTRACT = "0xe9b6e75c243b6100ffcb1c66e8f78f96feea727f";
const MAX_UINT256 = ethers.constants.MaxUint256;

// WETH ABI
const WETH_ABI = [
  {
    constant: false,
    inputs: [],
    name: "deposit",
    outputs: [],
    payable: true,
    stateMutability: "payable",
    type: "function",
  },
  {
    constant: true,
    inputs: [{ name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
  },
  {
    constant: false,
    inputs: [{ name: "wad", type: "uint256" }],
    name: "withdraw",
    outputs: [],
    type: "function",
  },
];

// ERC20 ABI
const ERC20_ABI = [
  {
    constant: false,
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    type: "function",
  },
];

// Router ABI (Uniswap V2-style)
const ROUTER_ABI = [
  {
    constant: false,
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    name: "swapExactTokensForETH",
    outputs: [{ name: "amounts", type: "uint256[]" }],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    name: "swapExactTokensForTokens",
    outputs: [{ name: "amounts", type: "uint256[]" }],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
];

// Configuration
const config = {
  SWAPS: {
    BEBOP: {
      BALANCE_PERCENTAGE_TO_SWAP: [10, 50],
    },
  },
  SETTINGS: {
    PAUSE_BETWEEN_ATTEMPTS: [5, 10],
  },
};

// Utility Functions
const printHeader = () => {
  console.log(chalk.cyan(figlet.textSync('Bebop Swap', { horizontalLayout: 'full' })));
  console.log(chalk.cyan('???????????????????????????????????????????????????????????????'));
  console.log(chalk.cyan('AUTO SWAP BOT - 0xzer0toher0'));
  console.log(chalk.cyan('Join Telegram: @ngadukbang'));
  console.log(chalk.cyan('???????????????????????????????????????????????????????????????'));
};

const showBalances = async (provider, wallet) => {
  console.log(chalk.blue('\n?? Wallet Balances:'));
  console.log(chalk.blue('???????????????????????'));
  try {
    // ETH balance
    const ethBalance = await provider.getBalance(wallet.address);
    const ethFormatted = parseFloat(ethers.utils.formatEther(ethBalance)).toFixed(6);
    console.log(chalk.blue(`ETH       -: ${ethFormatted}`));

    // WETH balance
    const wethContract = new ethers.Contract(WETH_CONTRACT, WETH_ABI, provider);
    const wethBalance = await wethContract.balanceOf(wallet.address);
    const wethFormatted = parseFloat(ethers.utils.formatEther(wethBalance)).toFixed(6);
    console.log(chalk.blue(`WETH       : ${wethFormatted}`));

    // cUSD balance
    const cusdContract = new ethers.Contract(CUSD_CONTRACT, ERC20_ABI, provider);
    const cusdBalance = await cusdContract.balanceOf(wallet.address);
    const cusdFormatted = parseFloat(ethers.utils.formatUnits(cusdBalance, 6)).toFixed(6);
    console.log(chalk.blue(`cUSD       : ${cusdFormatted}`));
  } catch (error) {
    console.log(chalk.red(`[!] Error getting balances: ${error.message}`));
  }
  console.log(chalk.blue('???????????????????????'));
};

// Retry function
const retryAsync = (fn, maxAttempts = 3) => async (...args) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(...args);
    } catch (error) {
      if (attempt === maxAttempts) {
        console.error(`Failed after ${maxAttempts} attempts: ${error.message}`);
        throw error;
      }
      const pause = Math.floor(
        Math.random() * (config.SETTINGS.PAUSE_BETWEEN_ATTEMPTS[1] - config.SETTINGS.PAUSE_BETWEEN_ATTEMPTS[0]) +
        config.SETTINGS.PAUSE_BETWEEN_ATTEMPTS[0]
      );
      console.warn(`Attempt ${attempt} failed: ${error.message}. Retrying in ${pause}s...`);
      await new Promise((resolve) => setTimeout(resolve, pause * 1000));
    }
  }
};

class Bebop {
  constructor(privateKey, accountIndex = 0) {
    this.accountIndex = accountIndex;
    this.provider = new ethers.providers.JsonRpcProvider("https://carrot.megaeth.com/rpc");
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.wethContract = new ethers.Contract(WETH_CONTRACT, WETH_ABI, this.wallet);
    this.cusdContract = new ethers.Contract(CUSD_CONTRACT, ERC20_ABI, this.wallet);
    this.routerContract = new ethers.Contract(ROUTER_CONTRACT, ROUTER_ABI, this.wallet);

    // Wrap methods with retry logic
    this.swapEthToWeth = retryAsync(this.swapEthToWeth.bind(this));
    this.approveWeth = retryAsync(this.approveWeth.bind(this));
    this.approveCusd = retryAsync(this.approveCusd.bind(this));
    this.unwrapWethToEth = retryAsync(this.unwrapWethToEth.bind(this));
    this.swapCusdToEth = retryAsync(this.swapCusdToEth.bind(this));
    this.swapEthToCusd = retryAsync(this.swapEthToCusd.bind(this));
    this.swapAllToEth = retryAsync(this.swapAllToEth.bind(this));
  }

  ethToWei(ethAmount) {
    return ethers.utils.parseEther(ethAmount.toString());
  }

  cusdToWei(cusdAmount) {
    return ethers.utils.parseUnits(cusdAmount.toString(), 6); // cUSD has 6 decimals
  }

  async swapEthToWeth(amountEth) {
    try {
      console.log(`${this.accountIndex} | Wrapping ${amountEth} ETH to WETH...`);
      const amountWei = this.ethToWei(amountEth);

      let gasLimit;
      try {
        gasLimit = await this.wethContract.estimateGas.deposit({ value: amountWei });
        gasLimit = gasLimit.mul(120).div(100);
      } catch (error) {
        console.warn(`${this.accountIndex} | Gas estimation failed: ${error.message}. Using default gas limit.`);
        gasLimit = 100000;
      }

      const tx = await this.wethContract.deposit({
        value: amountWei,
        gasLimit,
      });

      const receipt = await tx.wait();
      if (receipt.status === 1) {
        console.log(
          `${this.accountIndex} | ${amountEth} ETH wrapped to WETH successfully! TX: ${EXPLORER_URL_MEGAETH}${receipt.transactionHash}`
        );
        return true;
      } else {
        console.error(`${this.accountIndex} | Transaction failed: ${JSON.stringify(receipt)}`);
        return false;
      }
    } catch (error) {
      console.error(`${this.accountIndex} | Failed to swap ETH to WETH: ${error.message}`);
      throw error;
    }
  }

  async approveWeth() {
    try {
      console.log(`${this.accountIndex} | Approving WETH for spending...`);

      let gasLimit;
      try {
        gasLimit = await this.wethContract.estimateGas.approve(ROUTER_CONTRACT, MAX_UINT256);
        gasLimit = gasLimit.mul(120).div(100);
      } catch (error) {
        console.warn(`${this.accountIndex} | Gas estimation failed: ${error.message}. Using default gas limit.`);
        gasLimit = 100000;
      }

      const tx = await this.wethContract.approve(ROUTER_CONTRACT, MAX_UINT256, {
        gasLimit,
      });

      const receipt = await tx.wait();
      if (receipt.status === 1) {
        console.log(
          `${this.accountIndex} | WETH approved for spending successfully! TX: ${EXPLORER_URL_MEGAETH}${receipt.transactionHash}`
        );
        return true;
      } else {
        console.error(`${this.accountIndex} | WETH approval transaction failed: ${JSON.stringify(receipt)}`);
        return false;
      }
    } catch (error) {
      console.error(`${this.accountIndex} | Failed to approve WETH: ${error.message}`);
      throw error;
    }
  }

  async approveCusd() {
    try {
      console.log(`${this.accountIndex} | Approving cUSD for spending...`);

      let gasLimit;
      try {
        gasLimit = await this.cusdContract.estimateGas.approve(ROUTER_CONTRACT, MAX_UINT256);
        gasLimit = gasLimit.mul(120).div(100);
      } catch (error) {
        console.warn(`${this.accountIndex} | Gas estimation failed: ${error.message}. Using default gas limit.`);
        gasLimit = 100000;
      }

      const tx = await this.cusdContract.approve(ROUTER_CONTRACT, MAX_UINT256, {
        gasLimit,
      });

      const receipt = await tx.wait();
      if (receipt.status === 1) {
        console.log(
          `${this.accountIndex} | cUSD approved for spending successfully! TX: ${EXPLORER_URL_MEGAETH}${receipt.transactionHash}`
        );
        return true;
      } else {
        console.error(`${this.accountIndex} | cUSD approval transaction failed: ${JSON.stringify(receipt)}`);
        return false;
      }
    } catch (error) {
      console.error(`${this.accountIndex} | Failed to approve cUSD: ${error.message}`);
      throw error;
    }
  }

  async unwrapWethToEth(amountEth) {
    try {
      console.log(`${this.accountIndex} | Unwrapping ${amountEth} WETH to ETH...`);
      const amountWei = this.ethToWei(amountEth);

      let gasLimit;
      try {
        gasLimit = await this.wethContract.estimateGas.withdraw(amountWei);
        gasLimit = gasLimit.mul(120).div(100);
      } catch (error) {
        console.warn(`${this.accountIndex} | Gas estimation failed: ${error.message}. Using default gas limit.`);
        gasLimit = 100000;
      }

      const tx = await this.wethContract.withdraw(amountWei, {
        gasLimit,
      });

      const receipt = await tx.wait();
      if (receipt.status === 1) {
        console.log(
          `${this.accountIndex} | ${amountEth} WETH unwrapped to ETH successfully! TX: ${EXPLORER_URL_MEGAETH}${receipt.transactionHash}`
        );
        return true;
      } else {
        console.error(`${this.accountIndex} | WETH to ETH unwrap transaction failed: ${JSON.stringify(receipt)}`);
        return false;
      }
    } catch (error) {
      console.error(`${this.accountIndex} | Failed to unwrap WETH to ETH: ${error.message}`);
      throw error;
    }
  }

  async swapCusdToEth(amountCusd) {
    try {
      console.log(`${this.accountIndex} | Swapping ${amountCusd} cUSD to ETH...`);
      const amountWei = this.cusdToWei(amountCusd);

      await this.approveCusd();

      const path = [CUSD_CONTRACT, WETH_CONTRACT];
      const amountOutMin = 0;
      const to = this.wallet.address;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

      let gasLimit;
      try {
        gasLimit = await this.routerContract.estimateGas.swapExactTokensForETH(
          amountWei,
          amountOutMin,
          path,
          to,
          deadline
        );
        gasLimit = gasLimit.mul(120).div(100);
      } catch (error) {
        console.warn(`${this.accountIndex} | Gas estimation failed: ${error.message}. Using default gas limit.`);
        gasLimit = 200000;
      }

      const tx = await this.routerContract.swapExactTokensForETH(
        amountWei,
        amountOutMin,
        path,
        to,
        deadline,
        { gasLimit }
      );

      const receipt = await tx.wait();
      if (receipt.status === 1) {
        console.log(
          `${this.accountIndex} | ${amountCusd} cUSD swapped to ETH successfully! TX: ${EXPLORER_URL_MEGAETH}${receipt.transactionHash}`
        );
        return true;
      } else {
        console.error(`${this.accountIndex} | cUSD to ETH swap transaction failed: ${JSON.stringify(receipt)}`);
        return false;
      }
    } catch (error) {
      console.error(`${this.accountIndex} | Failed to swap cUSD to ETH: ${error.message}`);
      throw error;
    }
  }

  async swapEthToCusd(amountEth) {
    try {
      console.log(`${this.accountIndex} | Swapping ${amountEth} ETH to cUSD...`);
      const amountWei = this.ethToWei(amountEth);

      // Wrap ETH to WETH first
      await this.swapEthToWeth(amountEth);
      await this.approveWeth();

      const path = [WETH_CONTRACT, CUSD_CONTRACT];
      const amountOutMin = 0;
      const to = this.wallet.address;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

      let gasLimit;
      try {
        gasLimit = await this.routerContract.estimateGas.swapExactTokensForTokens(
          amountWei,
          amountOutMin,
          path,
          to,
          deadline
        );
        gasLimit = gasLimit.mul(120).div(100);
      } catch (error) {
        console.warn(`${this.accountIndex} | Gas estimation failed: ${error.message}. Using default gas limit.`);
        gasLimit = 200000;
      }

      const tx = await this.routerContract.swapExactTokensForTokens(
        amountWei,
        amountOutMin,
        path,
        to,
        deadline,
        { gasLimit }
      );

      const receipt = await tx.wait();
      if (receipt.status === 1) {
        console.log(
          `${this.accountIndex} | ${amountEth} ETH swapped to cUSD successfully! TX: ${EXPLORER_URL_MEGAETH}${receipt.transactionHash}`
        );
        return true;
      } else {
        console.error(`${this.accountIndex} | ETH to cUSD swap transaction failed: ${JSON.stringify(receipt)}`);
        return false;
      }
    } catch (error) {
      console.error(`${this.accountIndex} | Failed to swap ETH to cUSD: ${error.message}`);
      throw error;
    }
  }

  async swapAllToEth() {
    try {
      console.log(`${this.accountIndex} | Starting swap all to ETH...`);

      // Step 1: Unwrap all WETH to ETH
      let wethBalanceWei = await this.wethContract.balanceOf(this.wallet.address);
      let wethBalance = parseFloat(ethers.utils.formatEther(wethBalanceWei));

      if (wethBalance > 0) {
        console.log(`${this.accountIndex} | Unwrapping ${wethBalance} WETH to ETH...`);
        let result = await this.unwrapWethToEth(wethBalance);
        if (!result) {
          console.error(`${this.accountIndex} | Failed to unwrap WETH to ETH. Continuing with cUSD swap.`);
        }
      } else {
        console.log(`${this.accountIndex} | No WETH balance to unwrap.`);
      }

      // Step 2: Swap all cUSD to ETH
      let cusdBalanceWei = await this.cusdContract.balanceOf(this.wallet.address);
      let cusdBalance = parseFloat(ethers.utils.formatUnits(cusdBalanceWei, 6));

      if (cusdBalance > 0) {
        console.log(`${this.accountIndex} | Swapping ${cusdBalance} cUSD to ETH...`);
        let result = await this.swapCusdToEth(cusdBalance);
        if (!result) {
          console.error(`${this.accountIndex} | Failed to swap cUSD to ETH.`);
          return false;
        }
      } else {
        console.log(`${this.accountIndex} | No cUSD balance to swap.`);
      }

      console.log(`${this.accountIndex} | Swap all to ETH completed successfully!`);
      return true;
    } catch (error) {
      console.error(`${this.accountIndex} | Error in swap all to ETH: ${error.message}`);
      return false;
    }
  }

  async performSwapCycle() {
    try {
      console.log(`${this.accountIndex} | Starting swap cycle...`);

      // Step 1: ETH to WETH
      let ethBalanceWei = await this.provider.getBalance(this.wallet.address);
      let ethBalance = parseFloat(ethers.utils.formatEther(ethBalanceWei));
      let percentage = Math.random() * (config.SWAPS.BEBOP.BALANCE_PERCENTAGE_TO_SWAP[1] - config.SWAPS.BEBOP.BALANCE_PERCENTAGE_TO_SWAP[0]) + config.SWAPS.BEBOP.BALANCE_PERCENTAGE_TO_SWAP[0];
      let swapAmount = (ethBalance * percentage) / 100;
      swapAmount = parseFloat(swapAmount.toFixed(8));

      if (swapAmount < 0.00000001) {
        console.warn(`${this.accountIndex} | ETH swap amount too small. Using minimum amount.`);
        swapAmount = 0.00000001;
      }

      if (ethBalance < swapAmount) {
        console.error(`${this.accountIndex} | Insufficient ETH balance for swap.`);
        return false;
      }

      let result = await this.swapEthToWeth(swapAmount);
      if (!result) return false;

      // Step 2: WETH to ETH
      let wethBalanceWei = await this.wethContract.balanceOf(this.wallet.address);
      let wethBalance = parseFloat(ethers.utils.formatEther(wethBalanceWei));

      if (wethBalance <= 0) {
        console.error(`${this.accountIndex} | No WETH balance to unwrap.`);
        return false;
      }

      result = await this.unwrapWethToEth(wethBalance);
      if (!result) return false;

      // Step 3: ETH to cUSD
      ethBalanceWei = await this.provider.getBalance(this.wallet.address);
      ethBalance = parseFloat(ethers.utils.formatEther(ethBalanceWei));
      percentage = Math.random() * (config.SWAPS.BEBOP.BALANCE_PERCENTAGE_TO_SWAP[1] - config.SWAPS.BEBOP.BALANCE_PERCENTAGE_TO_SWAP[0]) + config.SWAPS.BEBOP.BALANCE_PERCENTAGE_TO_SWAP[0];
      swapAmount = (ethBalance * percentage) / 100;
      swapAmount = parseFloat(swapAmount.toFixed(8));

      if (swapAmount < 0.00000001) {
        console.warn(`${this.accountIndex} | ETH swap amount too small. Using minimum amount.`);
        swapAmount = 0.00000001;
      }

      if (ethBalance < swapAmount) {
        console.error(`${this.accountIndex} | Insufficient ETH balance for swap to cUSD.`);
        return false;
      }

      result = await this.swapEthToCusd(swapAmount);
      if (!result) return false;

      // Step 4: cUSD to ETH
      let cusdBalanceWei = await this.cusdContract.balanceOf(this.wallet.address);
      let cusdBalance = parseFloat(ethers.utils.formatUnits(cusdBalanceWei, 6));

      if (cusdBalance <= 0) {
        console.error(`${this.accountIndex} | No cUSD balance to swap.`);
        return false;
      }

      percentage = Math.random() * (config.SWAPS.BEBOP.BALANCE_PERCENTAGE_TO_SWAP[1] - config.SWAPS.BEBOP.BALANCE_PERCENTAGE_TO_SWAP[0]) + config.SWAPS.BEBOP.BALANCE_PERCENTAGE_TO_SWAP[0];
      swapAmount = (cusdBalance * percentage) / 100;
      swapAmount = parseFloat(swapAmount.toFixed(6));

      if (swapAmount < 0.000001) {
        console.warn(`${this.accountIndex} | cUSD swap amount too small. Using minimum amount.`);
        swapAmount = 0.000001;
      }

      result = await this.swapCusdToEth(swapAmount);
      if (!result) return false;

      console.log(`${this.accountIndex} | Swap cycle completed successfully!`);
      return true;
    } catch (error) {
      console.error(`${this.accountIndex} | Error in swap cycle: ${error.message}`);
      return false;
    }
  }
}

// Function to prompt for private key
function promptPrivateKey() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(chalk.cyan("?? Enter your private key (without '0x'): "), (privateKey) => {
      rl.close();
      resolve("0x" + privateKey.trim());
    });
  });
}

// Function to prompt for looping option
function promptLooping() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(chalk.cyan("?? Enable looping? (y/n): "), (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// Function to display menu and get user choice
function promptMenu() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(chalk.cyan('\n?? Menu:'));
    console.log(chalk.cyan('1. Check Balances'));
    console.log(chalk.cyan('2. Start Swap Cycle'));
    console.log(chalk.cyan('3. Swap All to ETH'));
    console.log(chalk.cyan('4. Exit'));
    rl.question(chalk.cyan('?? Enter your choice (1-4): '), (choice) => {
      rl.close();
      resolve(choice.trim());
    });
  });
}

// Main function with menu
async function main() {
  try {
    // Print header
    printHeader();

    // Prompt for private key
    const privateKey = await promptPrivateKey();
    if (!privateKey || !privateKey.startsWith("0x") || privateKey.length !== 66) {
      console.error(chalk.red("Invalid private key. It should be a 64-character hex string starting with '0x'."));
      return;
    }

    const bebop = new Bebop(privateKey, 1);

    // Main menu loop
    while (true) {
      // Show balances before displaying the menu
      await showBalances(bebop.provider, bebop.wallet);

      // Prompt for menu choice
      const choice = await promptMenu();

      if (choice === "1") {
        console.log(chalk.green("Balances already displayed."));
      } else if (choice === "2") {
        // Prompt for looping option
        const loop = await promptLooping();

        do {
          const result = await bebop.performSwapCycle();
          console.log(chalk.green(`Swap cycle result: ${result}`));

          if (loop) {
            const pause = Math.floor(
              Math.random() * (config.SETTINGS.PAUSE_BETWEEN_ATTEMPTS[1] - config.SETTINGS.PAUSE_BETWEEN_ATTEMPTS[0]) +
              config.SETTINGS.PAUSE_BETWEEN_ATTEMPTS[0]
            );
            console.log(chalk.cyan(`Waiting ${pause}s before next cycle...`));
            await new Promise((resolve) => setTimeout(resolve, pause * 1000));
          }
        } while (loop);
      } else if (choice === "3") {
        // Swap All to ETH
        const result = await bebop.swapAllToEth();
        console.log(chalk.green(`Swap all to ETH result: ${result}`));
      } else if (choice === "4") {
        console.log(chalk.cyan("Exiting Bebop Swap Bot. Goodbye!"));
        break;
      } else {
        console.log(chalk.red("Invalid choice. Please enter a number between 1 and 4."));
      }
    }
  } catch (error) {
    console.error(chalk.red(`Error in main: ${error.message}`));
  }
}

main();
