pragma circom 2.0.0;

// circomlib import
include "./bitify.circom";
include "./comparators.circom";
include "./mux1.circom";
// zk-kit imports
include "./safe-comparators.circom";

// Template to convert a 50-bit element into multiple 4-bit elements.
template UnpackRankedVoteOptionAndCheckUniqueness() {
    // Number of maximum valid vote options for the poll.
    var MAX_RANKED_VOTE_OPTIONS = 12;

    // vote option index
    signal input in;
    signal input voteOptions;

    // An array of voteOptions elements, each 4 bits long.
    signal output out[MAX_RANKED_VOTE_OPTIONS];
    signal output isUniqueAndValid;

    
    signal outs;
    var acc = 0;

    // check voteOptions validity
    var computedIsVoteOptionIndexValid = SafeLessThan(4)([voteOptions, MAX_RANKED_VOTE_OPTIONS + 1]);
    acc += (1 - computedIsVoteOptionIndexValid);

    // Convert the input signal to its bit representation.
    var bits[50]; 
    bits = Num2Bits(50)(in);

    for (var i = 0; i < MAX_RANKED_VOTE_OPTIONS; i++) {
        var tempBits[4];

        // Select and assign the appropriate 4-bit segment of the input's bit representation.
        for (var j = 0; j < 4; j++) {
            // Calculate the bit's index, considering the output element's position.
            tempBits[j] = bits[(i * 4) + j];
        }

        // Assign the numerical value of the 4-bit segment to the output signal.
        out[i] <== Bits2Num(4)(tempBits);
        var computedIsVoteOptionIndexValid = SafeLessThan(4)([out[i], voteOptions + 1]);
        acc += (1 - computedIsVoteOptionIndexValid);
        
        var isFirstZero = IsEqual()([out[i], 0]);
        
        // check if the i-th option is same as any other option (for nonzero values)
        for (var k = 0; k < i; k++) {
            var isEqualResult = IsEqual()([out[k], out[i]]);
            var muxResult = Mux1()([isEqualResult, 0], isFirstZero);
            acc += muxResult;
        }
    }
    outs <== acc;
    isUniqueAndValid <== IsZero()(outs);
}
