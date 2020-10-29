/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 * @flow strict-local
 */
import './shim'
import React, { useState, useEffect } from 'react';
import { SafeAreaView, StyleSheet, ScrollView, View, Text, StatusBar, Button } from 'react-native';
import { Picker } from '@react-native-community/picker'
import { Colors } from 'react-native/Libraries/NewAppScreen';
import { generateMnemonic, mnemonicToSeedSync, seedToRSKHDKey } from '@rsksmart/rif-id-mnemonic';
import { rskDIDFromPrivateKey as rskMainnetDIDFromPrivateKey, rskTestnetDIDFromPrivateKey } from '@rsksmart/rif-id-ethr-did';
import { ScanScreen } from './QRScanner'
import WalletConnect from "@walletconnect/client";
//import { connectToWC } from './walletConnect'
import { Alert } from "react-native";

// seed creation
const mnemonic = generateMnemonic(12)
const seed = mnemonicToSeedSync(mnemonic)
const hdKey = seedToRSKHDKey(seed)

function getDIDs(network, privateKeys) {
  const rskDIDFromPrivateKey = network === 30 ? rskMainnetDIDFromPrivateKey() : rskTestnetDIDFromPrivateKey()

  return privateKeys.map(privateKey => rskDIDFromPrivateKey(privateKey))
}

const App: () => React$Node = () => {
  // network and account setup
  const [network, setNetwork] = useState(30)
  const [selectedDid, setSelectedDid] = useState(0) // this would be the selected account
  // it is not sending update to the dapp yet...

  // wallet connect connection state
  const [showScanner, setShowScanner] = useState(false)
  const [wcUri, setWCUri] = useState('')
  const [connectedWC, setConnectedWC] = useState(false)
  const [wcError, setWcError] = useState(null)
  const [connector, setConnector] = useState(connector)

  // storing the wallet connect connector. this is used to approve and update sessions
  const [peerMeta, setPeerMeta] = useState(null)

  // hd wallet creation - (adding network just to make account change :S)
  const [privateKey0, setPrivateKey0] = useState(hdKey.derive(0 + 2*network).privateKey?.toString('hex'))
  const [privateKey1, setPrivateKey1] = useState(hdKey.derive(1 + 2*network).privateKey?.toString('hex'))

  const getPersonas = (network, privateKeys) => getDIDs(network, privateKeys)
  const getAddresses = (network, privateKeys) => getPersonas(network, privateKeys).map(did => did.address.toLowerCase())

  const updateSession = (chainId, selectedDID) => {
    const privateKeys = [
      hdKey.derive(0 + 2*network).privateKey?.toString('hex'),
      hdKey.derive(1 + 2*network).privateKey?.toString('hex')
    ]

    const session = {
      chainId,
      accounts: getAddresses(network, privateKeys)
    }

    console.log('update session', session)

    connector.updateSession(session)
    setSelectedDid(selectedDID)
    setNetwork(chainId)
    setPrivateKey0(privateKeys[0])
    setPrivateKey1(privateKeys[1])
  }

  let [did0, did1] = getPersonas(network, [privateKey0, privateKey1])

  // handle scanning the qr code. this will trigger connectWC function passing some handlers
  // the result of connectWC is the connector. this sets it on the state, and the uses it
  // to handle session request.
  // the other handlers are not implemented yet, but i comment what should be done there
  const handleScan = (uri) => {
    setShowScanner(false)
    setWCUri(uri)

    const connector = new WalletConnect({ uri });

    connector.on("session_request", (error, payload) => {
      // this is received when the connection with the dapp is stablished
      console.log("EVENT", "session_request", payload);

      // peerMeta has the information of the dapp requesting access
      const { peerMeta } = payload.params[0];
      setPeerMeta(peerMeta)

      /* payload:
        {
          id: 1,
          jsonrpc: '2.0'.
          method: 'session_request',
          params: [{
            peerId: '15d8b6a3-15bd-493e-9358-111e3a4e6ee4',
            peerMeta: {
              name: "WalletConnect Example",
              description: "Try out WalletConnect v1.x.x",
              icons: ["https://example.walletconnect.org/favicon.ico"],
              url: "https://example.walletconnect.org"
            }
          }]
        }
      */

      Alert.alert(
        "Session request",
        `Name: ${peerMeta.name} - Description: ${peerMeta.description} - Url: ${peerMeta.url}`,
        [
          {
            text: "OK", onPress: () => {
              // session is approved, the accounts and the chainId is sent
              // to the dapp
              connector.approveSession({
                chainId: network,
                accounts: [did0.address.toLowerCase(), did1.address.toLowerCase()],
                activeIndex: selectedDid
              })

              setConnectedWC(true)
            }
          },
          {
            text: "Deny access", onPress: () => {
              setPeerMeta(null)
              connector.rejectSession()
              setConnectedWC(false)
            }
          }
        ],
        { cancelable: true }
      )
    });

    connector.on("call_request", async (error, { method, params, id}) => {
      console.log("EVENT", "call_request", "method", method);
      console.log("EVENT", "call_request", "params", params);

      if (error) {
        throw error;
      }

      /* payload:
        {
          id: 1,
          jsonrpc: '2.0'.
          method: 'eth_sign',
          params: [
            "0xbc28ea04101f03ea7a94c1379bc3ab32e65e62d3",
            "My email is john@doe.com - 1537836206101"
          ]
        }
      */

      let address
      if (method === 'eth_sendTransaction') { address = params[0].from }
      else if (method === 'eth_sign') { address = params[0] }
      else throw new Error('Method not implemented (yet)')
      address = address.toLowerCase()

      let chosenDid
      if (address === did0.address.toLowerCase()) { chosenDid = did0 }
      else if (address === did1.address.toLowerCase()) { chosenDid = did1 }
      else throw new Error('Invalid persona :(')

      if (method === 'eth_sign') {
        Alert.alert(
          "Signature request",
          `Id: ${id} - Method: ${method} - Params: ${params}`,
          [
            {
              text: "OK", onPress: () => {
                // this approach is wrong, is just an example. the expected output of eth_sign is a signature
                // on the message without JWT wrapping
                chosenDid.signJWT(params[1], 1000)
                .then(result => connector.approveRequest({
                  id,
                  result,
                }))
              }
            },
            { text: "Deny access", onPress: () => connector.rejectRequest({ id }) }
          ],
          { cancelable: true }
        )
      } else if (method === 'eth_sendTransaction') {
        Alert.alert(
          "Transaction request",
          `Id: ${id} - Method: ${method} - Params: ${params}`,
          [
            {
              text: "OK", onPress: () => {
                // send transaction to the blockchain. as we are now using
                // always random accounts, none of them will have balance. i will
                // mock a transaction sent. the return value is a tx hash
                connector.approveRequest({
                  id,
                  result: '0x9b9eaa5043e878861c0d1c8184152311b25f5db64b1da179e383e6df332ae28b',
                })
              }
            },
            { text: "Deny access", onPress: () => connector.rejectRequest({ id }) }
          ],
          { cancelable: true }
        )
      }
    });

    connector.on("disconnect", (error, payload) => {
      console.log("EVENT", "disconnect");

      if (error) {
        throw error;
      }

      onDisconnect(payload)

      // Delete connector
    });

    return connector.createSession().then(() => setConnector(connector))
  }

  return (
    <>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={styles.scrollView}>
          {global.HermesInternal == null ? null : (
            <View style={styles.engine}>
              <Text style={styles.footer}>Engine: Hermes</Text>
            </View>
          )}
          <View style={styles.body}>
            {
              !showScanner && <>
                <View style={styles.sectionContainer}>
                  <Text style={styles.sectionTitle}>Mnemonic</Text>
                  <Text style={styles.sectionDescription}>{mnemonic}</Text>
                </View>
                <View style={styles.sectionContainer}>
                  <Picker
                    selectedValue={network}
                    onValueChange={(itemValue, itemIndex) => updateSession(itemValue, selectedDid)}
                  >
                    <Picker.Item label="RSK Mainnet" value={30} />
                    <Picker.Item label="RSK Testnet" value={31} />
                  </Picker>
                </View>
                <View style={styles.sectionContainer}>
                  <Text style={styles.sectionTitle}>Change persona</Text>
                  {
                    did0 && did1 && <Picker
                      selectedValue={selectedDid}
                      onValueChange={(itemValue, itemIndex) => updateSession(network, itemValue)}
                      enabled={network !== -1}
                    >
                      {selectedDid === -1 && <Picker.Item label='Choose an identity' value={-1} />}
                      <Picker.Item label={did0.did} value={0} />
                      <Picker.Item label={did1.did} value={1} />
                    </Picker>
                  }
                </View>
              </>
            }
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>Use wallet connect</Text>
              <Button title="Connect to Wallet Connect" onPress={() => setShowScanner(true)} enabled={selectedDid !== -1} />
            </View>
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionDescription}>Peer meta: {peerMeta && peerMeta.name}</Text>

              <Text style={styles.sectionDescription}>Wallet connect URI: {wcUri}</Text>
              <Text style={styles.sectionDescription}>Connected: {connectedWC}</Text>
              {wcError && <Text style={styles.sectionDescription}>Error: {wcError}</Text>}
            </View>
            {showScanner && <ScanScreen onScan={handleScan} onCancel={() => setShowScanner(false)} />}
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    backgroundColor: Colors.lighter,
  },
  engine: {
    position: 'absolute',
    right: 0,
  },
  body: {
    backgroundColor: Colors.white,
  },
  sectionContainer: {
    marginTop: 32,
    paddingHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: Colors.black,
  },
  sectionDescription: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: '400',
    color: Colors.dark,
  },
  highlight: {
    fontWeight: '700',
  },
  footer: {
    color: Colors.dark,
    fontSize: 12,
    fontWeight: '600',
    padding: 4,
    paddingRight: 12,
    textAlign: 'right',
  },
});

export default App;
